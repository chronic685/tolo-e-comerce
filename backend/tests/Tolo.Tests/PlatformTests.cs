using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Extensions.DependencyInjection;
using Tolo.Api.Middleware;
using Tolo.Tests.Support;

namespace Tolo.Tests;

public sealed class PlatformTests
{
    private static readonly string[] IntegrationPaths =
    [
        "/integrations/tolo-marketplace/verify-code",
        "/integrations/tolo-marketplace/delivery-jobs",
    ];

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
    public async Task OpenApi_document_lists_the_integration_routes()
    {
        using var f = new ApiFactory();
        var text = await f.CreateClient().GetStringAsync("/openapi/v1.json");
        foreach (var p in IntegrationPaths) Assert.Contains(p, text, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("wrong-key")]
    [InlineData("")]
    [InlineData(ApiFactory.InboundKey)] // the other direction's key must not open this door
    public async Task Integration_routes_reject_a_missing_or_wrong_key_with_401(string? key)
    {
        using var f = new ApiFactory();
        foreach (var path in IntegrationPaths)
        {
            var r = await f.MarketplaceClient(key).PostAsJsonAsync(path, new { });
            Assert.Equal(HttpStatusCode.Unauthorized, r.StatusCode);
        }
    }

    [Fact]
    public async Task A_bare_key_without_the_Bearer_scheme_is_401()
    {
        using var f = new ApiFactory();
        var c = f.CreateClient();
        c.DefaultRequestHeaders.TryAddWithoutValidation("Authorization", ApiFactory.SharedKey);
        Assert.Equal(HttpStatusCode.Unauthorized, (await c.PostAsJsonAsync(IntegrationPaths[0], new { code = "x" })).StatusCode);
    }

    [Fact]
    public async Task With_no_key_configured_every_integration_call_is_503_even_with_an_empty_bearer()
    {
        using var f = new ApiFactory(new() { ["TOLO_BACKEND_SHARED_KEY"] = "" });
        foreach (var path in IntegrationPaths)
        {
            Assert.Equal(HttpStatusCode.ServiceUnavailable, (await f.MarketplaceClient("secret").PostAsJsonAsync(path, new { })).StatusCode);
            var c = f.CreateClient();
            c.DefaultRequestHeaders.TryAddWithoutValidation("Authorization", "Bearer ");
            Assert.Equal(HttpStatusCode.ServiceUnavailable, (await c.PostAsJsonAsync(path, new { })).StatusCode);
        }
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
        var c = f.MarketplaceClient();
        var codes = new List<HttpStatusCode>();
        for (var i = 0; i < 5; i++) codes.Add((await c.PostAsJsonAsync(IntegrationPaths[0], new { code = "x" })).StatusCode);

        Assert.Equal(3, codes.Count(s => s == HttpStatusCode.OK));
        Assert.Equal(2, codes.Count(s => s == HttpStatusCode.TooManyRequests));
        for (var i = 0; i < 10; i++) Assert.Equal(HttpStatusCode.OK, (await c.GetAsync("/health")).StatusCode);
    }

    [Fact]
    public async Task Verify_code_has_its_own_tighter_limit()
    {
        using var f = new ApiFactory(new() { ["TOLO_VERIFY_CODE_RATE_LIMIT_PER_MINUTE"] = "2" });
        var c = f.MarketplaceClient();
        var codes = new List<HttpStatusCode>();
        for (var i = 0; i < 4; i++) codes.Add((await c.PostAsJsonAsync(IntegrationPaths[0], new { code = "x" })).StatusCode);
        Assert.Equal(2, codes.Count(s => s == HttpStatusCode.TooManyRequests));
    }

    private sealed class ThrowingJobStore : Tolo.Domain.Abstractions.IDeliveryJobStore
    {
        public Task<bool> AddIfAbsentAsync(Guid jobId, Tolo.Domain.Contracts.DeliveryJobRequest job, CancellationToken ct = default) =>
            throw new InvalidOperationException("secret internal detail");
    }

    [Fact]
    public async Task An_unhandled_error_is_a_generic_500_that_leaks_nothing()
    {
        using var f = new ApiFactory(configure: s => s.AddSingleton<Tolo.Domain.Abstractions.IDeliveryJobStore>(new ThrowingJobStore()));
        var body = System.Text.Json.Nodes.JsonNode.Parse(Contract.DeliveryJobContractTests.DocumentedJson)!.ToJsonString();
        var r = await f.MarketplaceClient().PostAsync(IntegrationPaths[1], new StringContent(body, System.Text.Encoding.UTF8, "application/json"));

        Assert.Equal(HttpStatusCode.InternalServerError, r.StatusCode);
        var text = await r.Content.ReadAsStringAsync();
        Assert.DoesNotContain("secret internal detail", text, StringComparison.Ordinal);
        Assert.Equal("""{"error":"Internal error."}""", text);
    }
}
