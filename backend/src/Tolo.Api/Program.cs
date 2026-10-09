using System.Net;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Diagnostics;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.EntityFrameworkCore;
using Tolo.Api.Auth;
using Tolo.Api.Configuration;
using Tolo.Api.Endpoints;
using Tolo.Api.Middleware;
using Tolo.Domain.Abstractions;
using Tolo.Domain.Catalog;
using Tolo.Domain.Common;
using Tolo.Domain.Identity;
using Tolo.Domain.Merchants;
using Tolo.Domain.Services;
using Tolo.Domain.Tolo;
using Tolo.Infrastructure.Fakes;
using Tolo.Infrastructure.Identity;
using Tolo.Infrastructure.Persistence;

var builder = WebApplication.CreateBuilder(args);
var settings = ToloSettings.From(builder.Configuration);

// Structured logging: one JSON object per line on stdout, with scopes (the correlation id) included.
builder.Logging.ClearProviders();
builder.Logging.AddJsonConsole(o => o.IncludeScopes = true);

builder.Services.AddSingleton(settings);
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddOpenApi();
// Enums go out the way the database spells them: pending_verification, published.
builder.Services.ConfigureHttpJsonOptions(o => o.SerializerOptions.Converters.Add(
    new System.Text.Json.Serialization.JsonStringEnumConverter(System.Text.Json.JsonNamingPolicy.SnakeCaseLower)));
builder.Services.AddHealthChecks();

// --- Identity: tokens are verified behind IIdentityProvider; roles always come from the database. ---
var jwt = new JwtOptions
{
    Issuer = settings.JwtIssuer,
    Audience = settings.JwtAudience,
    SigningKey = settings.JwtSigningKey,
    JwksUrl = settings.JwtJwksUrl,
};
builder.Services.AddSingleton(jwt);
builder.Services.AddHttpClient("jwks", c => c.Timeout = TimeSpan.FromSeconds(5));
// A singleton so the fetched JWKS stays cached between requests.
builder.Services.AddSingleton<IIdentityProvider>(sp => new JwtIdentityProvider(jwt, sp.GetRequiredService<IHttpClientFactory>().CreateClient("jwks"), sp.GetRequiredService<TimeProvider>()));
builder.Services.AddSingleton<DevTokenIssuer>();
builder.Services.AddScoped<IPrincipalResolver, PrincipalResolver>();
builder.Services.AddScoped<PhoneLinkService>();

// --- Tolo's own data (their MongoDB): fakes behind the anti-corruption interfaces until their schema is known. ---
builder.Services.AddSingleton<IToloCustomerDirectory, FakeToloCustomerDirectory>();
builder.Services.AddSingleton<IToloMerchantDirectory, FakeToloMerchantDirectory>();
builder.Services.AddSingleton<IToloDriverDirectory, FakeToloDriverDirectory>();

if (settings.DatabaseUrl is not null)
{
    // EF Core is DB-first here: it maps existing tables and never creates or migrates anything.
    var dataSource = ToloDbContext.CreateDataSource(ConnectionStrings.ToNpgsql(settings.DatabaseUrl));
    builder.Services.AddSingleton(dataSource);
    builder.Services.AddDbContext<ToloDbContext>((_, o) => ToloDbContext.Configure(o, dataSource));
    builder.Services.AddScoped<IAccountDirectory, EfAccountDirectory>();
    builder.Services.AddScoped<IPhoneLinkStore, EfPhoneLinkStore>();
    builder.Services.AddScoped<IMerchantReader, EfMerchantReader>();
    builder.Services.AddScoped<ICatalogReader, EfCatalogReader>();
    builder.Services.AddHealthChecks().AddCheck<DatabaseHealthCheck>("database", tags: ["ready"]);
}
else
{
    // No database: nobody has an account and the data routes answer 503, so a misconfigured deploy fails loudly instead of serving nothing.
    builder.Services.AddSingleton<InMemoryAccountDirectory>();
    builder.Services.AddSingleton<IAccountDirectory>(sp => sp.GetRequiredService<InMemoryAccountDirectory>());
    builder.Services.AddSingleton<IPhoneLinkStore, InMemoryPhoneLinkStore>();
    builder.Services.AddScoped<IMerchantReader, UnavailableReader>();
    builder.Services.AddScoped<ICatalogReader, UnavailableReader>();
}

builder.Services.AddScoped<MerchantModule>();
builder.Services.AddScoped<CatalogModule>();

builder.Services.AddAuthentication(ToloBearer.Scheme).AddScheme<Microsoft.AspNetCore.Authentication.AuthenticationSchemeOptions, ToloBearerHandler>(ToloBearer.Scheme, null);
builder.Services.AddAuthorizationBuilder()
    // Customer area: anonymous browsing is allowed (but a request that sent a token must have a valid one), and so is any signed-in
    // customer. Staff and admin accounts are not customers.
    .AddPolicy(ToloBearer.CustomerArea, p => p.RequireAssertion(ctx =>
        ctx.User.Identity?.IsAuthenticated == true
            ? ctx.User.IsInRole(Roles.Customer)
            : ctx.Resource is HttpContext http && http.Request.Headers.Authorization.Count == 0))
    .AddPolicy(ToloBearer.MerchantArea, p => p.RequireRole(Roles.MerchantOwner, Roles.MerchantStaff))
    .AddPolicy(ToloBearer.AdminArea, p => p.RequireRole(Roles.Staff, Roles.Admin, Roles.SuperAdmin));

builder.Services.AddRateLimiter(o =>
{
    o.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    // Per source IP. Health is never limited.
    o.GlobalLimiter = PartitionedRateLimiter.Create<HttpContext, string>(ctx =>
        ctx.Request.Path.StartsWithSegments("/health")
            ? RateLimitPartition.GetNoLimiter("health")
            : RateLimitPartition.GetFixedWindowLimiter(ClientKey(ctx), _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = settings.RateLimitPerMinute,
                Window = TimeSpan.FromMinutes(1),
                QueueLimit = 0,
            }));
    o.OnRejected = async (context, ct) =>
    {
        context.HttpContext.Response.StatusCode = StatusCodes.Status429TooManyRequests;
        await context.HttpContext.Response.WriteAsJsonAsync(new { error = "Too many requests." }, ct);
    };
});

var app = builder.Build();

if (settings.TrustForwardedHeaders)
{
    var forwarded = new ForwardedHeadersOptions { ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto };
    forwarded.KnownIPNetworks.Clear();
    forwarded.KnownProxies.Clear();
    app.UseForwardedHeaders(forwarded);
}

Action<ILogger, Exception?> logUnhandled =
    LoggerMessage.Define(LogLevel.Error, new EventId(1, "Unhandled"), "Unhandled exception");

app.UseMiddleware<CorrelationIdMiddleware>();
app.UseExceptionHandler(handler => handler.Run(async context =>
{
    var error = context.Features.Get<IExceptionHandlerFeature>()?.Error;
    if (error is not (ForbiddenException or DatabaseNotConfiguredException))
        logUnhandled(context.RequestServices.GetRequiredService<ILoggerFactory>().CreateLogger("Tolo.Unhandled"), error);
    (int status, string message) = error switch
    {
        ForbiddenException f => (StatusCodes.Status403Forbidden, f.Message),
        DatabaseNotConfiguredException => (StatusCodes.Status503ServiceUnavailable, "The database is not configured."),
        _ => (StatusCodes.Status500InternalServerError, "Internal error."),
    };
    context.Response.StatusCode = status;
    await context.Response.WriteAsJsonAsync(new { error = message });
}));
app.UseRateLimiter();
app.UseMiddleware<SharedKeyMiddleware>(new SharedKeyOptions("/internal", settings.SharedKey));
app.UseAuthentication();
app.UseAuthorization();

app.MapOpenApi();
app.MapSystem(settings, app.Environment.IsDevelopment());
app.MapAreas();

app.Run();

static string ClientKey(HttpContext ctx) => (ctx.Connection.RemoteIpAddress ?? IPAddress.None).ToString();

/// <summary>Exposes the entry point to WebApplicationFactory in the test project.</summary>
public partial class Program;
