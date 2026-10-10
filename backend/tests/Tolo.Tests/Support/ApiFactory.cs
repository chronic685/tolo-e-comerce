using System.Net.Http.Headers;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Tolo.Domain.Identity;
using Tolo.Infrastructure.Fakes;
using Tolo.Infrastructure.Identity;

namespace Tolo.Tests.Support;

/// <summary>
/// The API in memory, configured only through the same environment-style keys production uses. Without a database URL, accounts live in
/// <see cref="Accounts"/> and every data route answers 503; with one (a LOCAL test database), the real readers and account directory run.
/// </summary>
public sealed class ApiFactory : WebApplicationFactory<Program>
{
    public const string SharedKey = "test-shared-key-not-a-secret";
    public const string Issuer = "https://tolo.test/issuer";
    public const string Audience = "tolo-marketplace-api";
    public const string SigningKey = "test-signing-key-test-signing-key-0123456789";

    private readonly Dictionary<string, string?> _settings;
    private readonly string _environment;
    private readonly Action<IServiceCollection>? _configure;

    public ApiFactory(Dictionary<string, string?>? overrides = null, string? databaseUrl = null, string environment = "Production", Action<IServiceCollection>? configure = null)
    {
        _settings = new Dictionary<string, string?>
        {
            ["TOLO_BACKEND_SHARED_KEY"] = SharedKey,
            ["TOLO_JWT_ISSUER"] = Issuer,
            ["TOLO_JWT_AUDIENCE"] = Audience,
            ["TOLO_JWT_SIGNING_KEY"] = SigningKey,
        };
        if (databaseUrl is not null) _settings["DATABASE_URL"] = databaseUrl;
        if (overrides is not null) foreach (var (k, v) in overrides) _settings[k] = v;
        _environment = environment;
        _configure = configure;
    }

    public InMemoryAccountDirectory Accounts => Services.GetRequiredService<InMemoryAccountDirectory>();

    public DevTokenIssuer Tokens => Services.GetRequiredService<DevTokenIssuer>();

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment(_environment);
        foreach (var (k, v) in _settings) builder.UseSetting(k, v);
        builder.ConfigureServices(services => _configure?.Invoke(services));
    }

    /// <summary>A client signed in as <paramref name="userId"/> (the token's subject), or anonymous when null.</summary>
    public HttpClient ClientFor(Guid? userId, string? phone = null)
    {
        var client = CreateClient();
        if (userId is { } id) client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", Tokens.Issue(id.ToString(), phone));
        return client;
    }

    public HttpClient ClientWithToken(string token)
    {
        var client = CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    /// <summary>Adds an in-memory account (no-database mode) and returns its id.</summary>
    public Guid AddAccount(string[] roles, string[]? pages = null, Guid[]? merchants = null)
    {
        var id = Guid.NewGuid();
        Accounts.Add(new ToloPrincipal
        {
            UserId = id,
            Roles = roles.ToHashSet(),
            Pages = (pages ?? []).ToHashSet(),
            MerchantIds = (merchants ?? []).ToHashSet(),
        });
        return id;
    }
}
