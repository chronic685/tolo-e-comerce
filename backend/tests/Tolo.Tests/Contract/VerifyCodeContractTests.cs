using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Tolo.Domain.Abstractions;
using Tolo.Infrastructure.Fakes;
using Tolo.Tests.Support;

namespace Tolo.Tests.Contract;

// docs/integration/tolo-app.md, "Verify-code contract".
public sealed class VerifyCodeContractTests
{
    private const string Path = "/integrations/tolo-marketplace/verify-code";

    private static async Task<(ApiFactory f, string code)> SeededAsync(string phone = "0912 345-678")
    {
        var f = new ApiFactory();
        f.Customers.Add(new VerifiedCustomer("c1", phone, "Abebe Kebede"));
        return (f, await f.Codes.IssueAsync("c1"));
    }

    private static async Task<JsonElement> PostAsync(HttpClient c, string code)
    {
        var r = await c.PostAsJsonAsync(Path, new { code });
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        return await r.Content.ReadFromJsonAsync<JsonElement>();
    }

    [Fact]
    public async Task Valid_code_returns_exactly_valid_phone_name_with_the_phone_normalized()
    {
        var (f, code) = await SeededAsync();
        using var _ = f;
        var json = await PostAsync(f.MarketplaceClient(), code);

        Assert.True(json.GetProperty("valid").GetBoolean());
        Assert.Equal("+251912345678", json.GetProperty("phone").GetString());
        Assert.Equal("Abebe Kebede", json.GetProperty("name").GetString());
        Assert.Equal(["name", "phone", "valid"], json.EnumerateObject().Select(p => p.Name).Order().ToArray());
    }

    [Fact]
    public async Task Replay_returns_already_used()
    {
        var (f, code) = await SeededAsync();
        using var _ = f;
        var c = f.MarketplaceClient();
        await PostAsync(c, code);
        var json = await PostAsync(c, code);

        Assert.False(json.GetProperty("valid").GetBoolean());
        Assert.Equal("already_used", json.GetProperty("reason").GetString());
        Assert.Equal(["reason", "valid"], json.EnumerateObject().Select(p => p.Name).Order().ToArray());
    }

    [Fact]
    public async Task Unknown_code_returns_invalid_code()
    {
        using var f = new ApiFactory();
        var json = await PostAsync(f.MarketplaceClient(), "no-such-code");
        Assert.False(json.GetProperty("valid").GetBoolean());
        Assert.Equal("invalid_code", json.GetProperty("reason").GetString());
    }

    [Fact]
    public async Task Expired_code_returns_expired_code_then_already_used()
    {
        var time = new TestTime();
        var store = new InMemoryLoginCodeStore();
        var customers = new InMemoryCustomerDirectory();
        customers.Add(new VerifiedCustomer("c1", "0912345678", "A"));
        var svc = new Tolo.Domain.Services.LoginCodeService(store, customers, time, TimeSpan.FromMinutes(3));

        var code = await svc.IssueAsync("c1");
        time.Advance(TimeSpan.FromMinutes(3) + TimeSpan.FromSeconds(1));

        Assert.Equal("expired_code", (await svc.VerifyAsync(code)).Reason);
        // The code was spent by the attempt: it must never verify again.
        Assert.Equal("already_used", (await svc.VerifyAsync(code)).Reason);
    }

    [Fact]
    public async Task A_code_redeems_once_even_under_concurrency()
    {
        var (f, code) = await SeededAsync();
        using var _ = f;
        var c = f.MarketplaceClient();
        var results = await Task.WhenAll(Enumerable.Range(0, 12).Select(_ => PostAsync(c, code)));
        Assert.Equal(1, results.Count(r => r.GetProperty("valid").GetBoolean()));
    }

    [Fact]
    public async Task A_customer_without_a_usable_verified_phone_reads_as_invalid_code()
    {
        var (f, code) = await SeededAsync(phone: "not a phone");
        using var _ = f;
        var json = await PostAsync(f.MarketplaceClient(), code);
        Assert.False(json.GetProperty("valid").GetBoolean());
        Assert.Equal("invalid_code", json.GetProperty("reason").GetString());
    }

    [Fact]
    public async Task Request_body_never_supplies_identity()
    {
        var (f, code) = await SeededAsync();
        using var _ = f;
        var r = await f.MarketplaceClient().PostAsJsonAsync(Path, new { code, phone = "+251911111111", name = "Mallory" });
        var json = await r.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("+251912345678", json.GetProperty("phone").GetString());
        Assert.Equal("Abebe Kebede", json.GetProperty("name").GetString());
    }

    [Theory]
    [InlineData("")]
    [InlineData("not json")]
    [InlineData("null")]
    public async Task Malformed_body_is_400(string body)
    {
        using var f = new ApiFactory();
        var r = await f.MarketplaceClient().PostAsync(Path, new StringContent(body, System.Text.Encoding.UTF8, "application/json"));
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
    }

    [Fact]
    public async Task Missing_code_is_invalid_code()
    {
        using var f = new ApiFactory();
        var r = await f.MarketplaceClient().PostAsJsonAsync(Path, new { });
        var json = await r.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("invalid_code", json.GetProperty("reason").GetString());
    }
}
