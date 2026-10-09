using System.Net;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.EntityFrameworkCore;
using Tolo.Api.Auth;
using Tolo.Api.Configuration;
using Tolo.Api.Endpoints;
using Tolo.Api.Middleware;
using Tolo.Domain.Abstractions;
using Tolo.Domain.Services;
using Tolo.Infrastructure.Fakes;
using Tolo.Infrastructure.Marketplace;
using Tolo.Infrastructure.Persistence;

var builder = WebApplication.CreateBuilder(args);
var settings = ToloSettings.From(builder.Configuration);

// Structured logging: one JSON object per line on stdout, with scopes (the correlation id) included.
builder.Logging.ClearProviders();
builder.Logging.AddJsonConsole(o => o.IncludeScopes = true);

builder.Services.AddSingleton(settings);
builder.Services.AddOpenApi();
builder.Services.AddHealthChecks();

// --- Tolo-owned data that does not exist yet: in-memory fakes. Every one is marked TODO(tolo-data) in its source. ---
builder.Services.AddSingleton<InMemoryLoginCodeStore>();
builder.Services.AddSingleton<ILoginCodeStore>(sp => sp.GetRequiredService<InMemoryLoginCodeStore>());
builder.Services.AddSingleton<InMemoryCustomerDirectory>();
builder.Services.AddSingleton<ICustomerDirectory>(sp => sp.GetRequiredService<InMemoryCustomerDirectory>());
builder.Services.AddSingleton<InMemoryDeliveryJobStore>();
builder.Services.AddSingleton<IDeliveryJobStore>(sp => sp.GetRequiredService<InMemoryDeliveryJobStore>());

builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddSingleton(sp => new LoginCodeService(
    sp.GetRequiredService<ILoginCodeStore>(),
    sp.GetRequiredService<ICustomerDirectory>(),
    sp.GetRequiredService<TimeProvider>(),
    TimeSpan.FromSeconds(settings.LoginCodeTtlSeconds)));
builder.Services.AddSingleton<DeliveryJobIntake>();

builder.Services.AddSingleton(new MarketplaceOptions { FunctionsUrl = settings.MarketplaceFunctionsUrl, InboundKey = settings.InboundKey });
builder.Services.AddHttpClient<IMarketplaceClient, MarketplaceClient>(c => c.Timeout = TimeSpan.FromSeconds(10));

builder.Services.AddSingleton<IAppAuthenticator>(
    settings.AllowFakeAppAuth ? new FakeAppAuthenticator() : new NotConfiguredAppAuthenticator());

if (settings.DatabaseUrl is not null)
{
    // EF Core is DB-first here: it maps existing tables and never creates or migrates anything.
    builder.Services.AddDbContext<ToloDbContext>(o => o.UseNpgsql(ConnectionStrings.ToNpgsql(settings.DatabaseUrl)));
    builder.Services.AddScoped<IPhoneLinkStore, EfPhoneLinkStore>();
    builder.Services.AddScoped<PhoneLinkService>();
    builder.Services.AddHealthChecks().AddCheck<DatabaseHealthCheck>("database", tags: ["ready"]);
}

builder.Services.AddRateLimiter(o =>
{
    o.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    // Per source IP, since the integration routes have no caller identity before the key check. Health is never limited.
    o.GlobalLimiter = PartitionedRateLimiter.Create<HttpContext, string>(ctx =>
        ctx.Request.Path.StartsWithSegments("/health")
            ? RateLimitPartition.GetNoLimiter("health")
            : RateLimitPartition.GetFixedWindowLimiter(ClientKey(ctx), _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = settings.RateLimitPerMinute,
                Window = TimeSpan.FromMinutes(1),
                QueueLimit = 0,
            }));
    o.AddPolicy("verify-code", ctx => RateLimitPartition.GetFixedWindowLimiter(ClientKey(ctx), _ => new FixedWindowRateLimiterOptions
    {
        PermitLimit = settings.VerifyCodeRateLimitPerMinute,
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

app.UseMiddleware<CorrelationIdMiddleware>();
app.UseExceptionHandler(handler => handler.Run(async context =>
{
    context.Response.StatusCode = StatusCodes.Status500InternalServerError;
    await context.Response.WriteAsJsonAsync(new { error = "Internal error." });
}));
app.UseRateLimiter();
app.UseMiddleware<SharedKeyMiddleware>(new SharedKeyOptions("/integrations", settings.SharedKey));

app.MapOpenApi();
app.MapHealthEndpoints();
app.MapIntegrationEndpoints();
app.MapAppEndpoints();

app.Run();

static string ClientKey(HttpContext ctx) => (ctx.Connection.RemoteIpAddress ?? IPAddress.None).ToString();

/// <summary>Exposes the entry point to WebApplicationFactory in the test project.</summary>
public partial class Program;
