using System.Net.Http.Headers;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Tolo.Domain.Abstractions;
using Tolo.Domain.Services;
using Tolo.Infrastructure.Fakes;

namespace Tolo.Tests.Support;

/// <summary>The API in memory, configured only through the same environment-style keys production uses. No database, no network.</summary>
public sealed class ApiFactory : WebApplicationFactory<Program>
{
    public const string SharedKey = "test-shared-key-not-a-secret";
    public const string InboundKey = "test-inbound-key-not-a-secret";

    private readonly Dictionary<string, string?> _settings;
    private readonly Action<IServiceCollection>? _configure;

    public ApiFactory(Dictionary<string, string?>? overrides = null, IMarketplaceClient? marketplace = null, Action<IServiceCollection>? configure = null)
    {
        _settings = new Dictionary<string, string?>
        {
            ["TOLO_BACKEND_SHARED_KEY"] = SharedKey,
            ["TOLO_BACKEND_INBOUND_KEY"] = InboundKey,
            ["TOLO_ALLOW_FAKE_APP_AUTH"] = "true",
        };
        if (overrides is not null) foreach (var (k, v) in overrides) _settings[k] = v;
        Marketplace = marketplace;
        _configure = configure;
    }

    public IMarketplaceClient? Marketplace { get; }

    public InMemoryCustomerDirectory Customers => Services.GetRequiredService<InMemoryCustomerDirectory>();

    public InMemoryDeliveryJobStore Jobs => Services.GetRequiredService<InMemoryDeliveryJobStore>();

    public LoginCodeService Codes => Services.GetRequiredService<LoginCodeService>();

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        foreach (var (k, v) in _settings) builder.UseSetting(k, v);
        builder.ConfigureServices(services =>
        {
            _configure?.Invoke(services);
            if (Marketplace is null) return;
            foreach (var d in services.Where(d => d.ServiceType == typeof(IMarketplaceClient)).ToList()) services.Remove(d);
            services.AddSingleton(Marketplace);
        });
    }

    /// <summary>A client carrying the marketplace-to-Tolo key.</summary>
    public HttpClient MarketplaceClient(string? key = SharedKey)
    {
        var client = CreateClient();
        if (key is not null) client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", key);
        return client;
    }
}
