using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Extensions.DependencyInjection;
using Tolo.Api.Middleware;
using Tolo.Domain.Catalog;
using Tolo.Domain.Common;
using Tolo.Domain.Identity;
using Tolo.Infrastructure.Fakes;
using Tolo.Tests.Support;

namespace Tolo.Tests;

public sealed class PlatformTests
{
    [Fact]
    public async Task Health_is_open_and_ok()
    {
        using var f = new ApiFactory();
        var r = await f.CreateClient().GetAsync("/health");
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        Assert.Equal("ok", (await r.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("status").GetString());
    }

    [Fact]
    public async Task Ready_without_a_database_configured_says_so()
    {
        using var f = new ApiFactory();
        var r = await f.CreateClient().GetAsync("/health/ready");
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        Assert.Equal("not_configured", (await r.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("database").GetString());
    }

    [Fact]
    public async Task OpenApi_document_lists_the_three_areas()
    {
        using var f = new ApiFactory();
        var text = await f.CreateClient().GetStringAsync("/openapi/v1.json");
        foreach (var p in new[] { "/api/customer/merchants", "/api/merchant/merchants", "/api/admin/merchants", "/api/customer/products", "/api/admin/products" })
            Assert.Contains(p, text, StringComparison.Ordinal);
    }

    // --- shared key on /internal ---

    private static HttpClient WithKey(ApiFactory f, string? key)
    {
        var c = f.CreateClient();
        if (key is not null) c.DefaultRequestHeaders.TryAddWithoutValidation("Authorization", key);
        return c;
    }

    [Theory]
    [InlineData(null)]
    [InlineData("Bearer wrong-key")]
    [InlineData("Bearer ")]
    [InlineData(ApiFactory.SharedKey)] // no Bearer scheme
    public async Task Internal_rejects_a_missing_or_wrong_key(string? header)
    {
        using var f = new ApiFactory();
        Assert.Equal(HttpStatusCode.Unauthorized, (await WithKey(f, header).GetAsync("/internal/ping")).StatusCode);
    }

    [Fact]
    public async Task Internal_accepts_the_right_key()
    {
        using var f = new ApiFactory();
        Assert.Equal(HttpStatusCode.OK, (await WithKey(f, "Bearer " + ApiFactory.SharedKey).GetAsync("/internal/ping")).StatusCode);
    }

    [Fact]
    public async Task Internal_with_no_key_configured_is_503_even_with_an_empty_bearer()
    {
        using var f = new ApiFactory(new() { ["TOLO_BACKEND_SHARED_KEY"] = "" });
        Assert.Equal(HttpStatusCode.ServiceUnavailable, (await WithKey(f, "Bearer secret").GetAsync("/internal/ping")).StatusCode);
        Assert.Equal(HttpStatusCode.ServiceUnavailable, (await WithKey(f, "Bearer ").GetAsync("/internal/ping")).StatusCode);
    }

    [Fact]
    public async Task A_user_token_does_not_open_the_internal_door()
    {
        using var f = new ApiFactory();
        var id = f.AddAccount([Roles.SuperAdmin]);
        Assert.Equal(HttpStatusCode.Unauthorized, (await f.ClientFor(id).GetAsync("/internal/ping")).StatusCode);
    }

    [Theory]
    [InlineData("Bearer k", "k", true)]
    [InlineData("Bearer k ", "k", false)]
    [InlineData("bearer k", "k", false)]
    [InlineData("Bearer kk", "k", false)]
    [InlineData("Bearer ", "k", false)]
    [InlineData("", "k", false)]
    public void Bearer_comparison_is_exact(string header, string key, bool expected) =>
        Assert.Equal(expected, SharedKeyMiddleware.BearerMatches(header, key));

    // --- correlation ids, rate limiting, errors ---

    [Fact]
    public async Task Every_response_carries_a_correlation_id_and_a_safe_supplied_one_is_echoed()
    {
        using var f = new ApiFactory();
        var generated = await f.CreateClient().GetAsync("/health");
        Assert.Matches("^[0-9a-f]{32}$", generated.Headers.GetValues("X-Correlation-Id").Single());

        using var ok = new HttpRequestMessage(HttpMethod.Get, "/health");
        ok.Headers.Add("X-Correlation-Id", "req-123.abc");
        Assert.Equal("req-123.abc", (await f.CreateClient().SendAsync(ok)).Headers.GetValues("X-Correlation-Id").Single());

        using var bad = new HttpRequestMessage(HttpMethod.Get, "/health");
        bad.Headers.Add("X-Correlation-Id", "has spaces & <tags>");
        Assert.NotEqual("has spaces & <tags>", (await f.CreateClient().SendAsync(bad)).Headers.GetValues("X-Correlation-Id").Single());
    }

    [Fact]
    public async Task Rate_limit_returns_429_after_the_per_minute_budget_but_never_for_health()
    {
        using var f = new ApiFactory(new() { ["TOLO_RATE_LIMIT_PER_MINUTE"] = "3" });
        var c = f.CreateClient();
        var codes = new List<HttpStatusCode>();
        for (var i = 0; i < 5; i++) codes.Add((await c.GetAsync("/api/customer/categories")).StatusCode);

        Assert.Equal(2, codes.Count(s => s == HttpStatusCode.TooManyRequests));
        for (var i = 0; i < 10; i++) Assert.Equal(HttpStatusCode.OK, (await c.GetAsync("/health")).StatusCode);
    }

    [Fact]
    public async Task Data_routes_without_a_database_are_503_not_an_empty_list()
    {
        using var f = new ApiFactory();
        Assert.Equal(HttpStatusCode.ServiceUnavailable, (await f.CreateClient().GetAsync("/api/customer/merchants")).StatusCode);
    }

    private sealed class ThrowingReader : ICatalogReader
    {
        public Task<IReadOnlyList<Category>> ListCategoriesAsync(bool includeInactive, CancellationToken ct = default) =>
            throw new InvalidOperationException("secret internal detail");

        public Task<Page<ProductSummary>> ListPublicProductsAsync(ProductQuery query, PageRequest page, CancellationToken ct = default) => throw new NotSupportedException();

        public Task<PublicProduct?> GetPublicProductAsync(Guid id, CancellationToken ct = default) => throw new NotSupportedException();

        public Task<Page<ManagedProductSummary>> ListManagedProductsAsync(ProductQuery query, PageRequest page, IReadOnlyCollection<Guid>? onlyMerchantIds, CancellationToken ct = default) => throw new NotSupportedException();

        public Task<ManagedProduct?> GetManagedProductAsync(Guid id, CancellationToken ct = default) => throw new NotSupportedException();
    }

    [Fact]
    public async Task An_unhandled_error_is_a_generic_500_that_leaks_nothing()
    {
        using var f = new ApiFactory(configure: s => s.AddScoped<ICatalogReader, ThrowingReader>());
        var r = await f.CreateClient().GetAsync("/api/customer/categories");
        Assert.Equal(HttpStatusCode.InternalServerError, r.StatusCode);
        Assert.Equal("""{"error":"Internal error."}""", await r.Content.ReadAsStringAsync());
    }

    // --- dev tokens ---

    [Fact]
    public async Task Dev_token_endpoint_exists_only_when_enabled_in_development()
    {
        using var off = new ApiFactory(environment: "Development");
        Assert.Equal(HttpStatusCode.NotFound, (await off.CreateClient().PostAsync("/dev/token?sub=x", null)).StatusCode);

        using var on = new ApiFactory(new() { ["TOLO_ENABLE_DEV_TOKENS"] = "true" }, environment: "Development");
        var r = await on.CreateClient().PostAsync("/dev/token?sub=" + Guid.NewGuid(), null);
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        Assert.False(string.IsNullOrEmpty((await r.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("token").GetString()));
    }

    [Fact]
    public void Dev_tokens_outside_development_stop_the_app_from_starting()
    {
        using var f = new ApiFactory(new() { ["TOLO_ENABLE_DEV_TOKENS"] = "true" }, environment: "Production");
        Assert.ThrowsAny<Exception>(() => f.CreateClient());
    }

    [Fact]
    public void The_in_memory_account_directory_is_what_tests_use_without_a_database()
    {
        using var f = new ApiFactory();
        Assert.IsType<InMemoryAccountDirectory>(f.Services.GetRequiredService<IAccountDirectory>());
    }
}
