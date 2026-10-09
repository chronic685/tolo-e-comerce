using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Tolo.Domain.Abstractions;
using Tolo.Domain.Contracts;
using Tolo.Infrastructure.Marketplace;
using Tolo.Tests.Support;

namespace Tolo.Tests.Contract;

// The calls this backend makes TO the marketplace: merchant-application-status (tolo-app.md) and delivery-status-callback (delivery-handoff.md).
public sealed class MarketplaceClientContractTests
{
    private const string Base = "https://project.example.invalid/functions/v1";

    private sealed class Handler(Func<HttpRequestMessage, string?, HttpResponseMessage> respond) : HttpMessageHandler
    {
        public HttpRequestMessage? Request { get; private set; }
        public string? Body { get; private set; }

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            Request = request;
            Body = request.Content is null ? null : await request.Content.ReadAsStringAsync(ct);
            return respond(request, Body);
        }
    }

    private static (MarketplaceClient client, Handler handler) Make(Func<HttpRequestMessage, string?, HttpResponseMessage> respond, string? key = ApiFactory.InboundKey)
    {
        var handler = new Handler(respond);
        return (new MarketplaceClient(new HttpClient(handler), new MarketplaceOptions { FunctionsUrl = Base + "/", InboundKey = key }), handler);
    }

    private static HttpResponseMessage Json(HttpStatusCode code, string json) =>
        new(code) { Content = new StringContent(json, System.Text.Encoding.UTF8, "application/json") };

    [Fact]
    public async Task Status_request_is_a_POST_with_the_inbound_key_and_only_a_phone()
    {
        var (client, handler) = Make((_, _) => Json(HttpStatusCode.OK, """{"phone":"+251912345678","is_merchant":false,"application":null}"""));
        await client.GetMerchantApplicationStatusAsync("+251912345678");

        Assert.Equal(HttpMethod.Post, handler.Request!.Method);
        Assert.Equal($"{Base}/merchant-application-status", handler.Request.RequestUri!.ToString());
        Assert.Equal("Bearer " + ApiFactory.InboundKey, handler.Request.Headers.Authorization!.ToString());
        using var sent = JsonDocument.Parse(handler.Body!);
        Assert.Equal(["phone"], sent.RootElement.EnumerateObject().Select(p => p.Name).ToArray());
        Assert.Equal("+251912345678", sent.RootElement.GetProperty("phone").GetString());
    }

    [Fact]
    public async Task Status_response_in_the_documented_shape_is_read()
    {
        var (client, _) = Make((_, _) => Json(HttpStatusCode.OK, """
            { "phone": "+251912345678", "is_merchant": true,
              "application": { "id": "8c1d", "status": "approved", "submitted_at": "2026-10-01T09:12:00Z", "reviewed_at": "2026-10-01T14:40:00Z", "note": null } }
            """));
        var s = await client.GetMerchantApplicationStatusAsync("+251912345678");

        Assert.True(s.IsMerchant);
        Assert.Equal("approved", s.Application!.Status);
        Assert.Equal("8c1d", s.Application.Id);
        Assert.Null(s.Application.Note);
    }

    [Fact]
    public async Task Status_response_with_no_application_is_read()
    {
        var (client, _) = Make((_, _) => Json(HttpStatusCode.OK, """{"phone":"+251912345678","is_merchant":false,"application":null}"""));
        var s = await client.GetMerchantApplicationStatusAsync("+251912345678");
        Assert.False(s.IsMerchant);
        Assert.Null(s.Application);
    }

    [Theory]
    [InlineData(HttpStatusCode.Unauthorized)]
    [InlineData(HttpStatusCode.BadRequest)]
    [InlineData(HttpStatusCode.ServiceUnavailable)]
    [InlineData(HttpStatusCode.InternalServerError)]
    public async Task Any_status_error_means_dont_change_the_button(HttpStatusCode code)
    {
        var (client, _) = Make((_, _) => Json(code, """{"error":"x"}"""));
        await Assert.ThrowsAsync<MarketplaceUnavailableException>(() => client.GetMerchantApplicationStatusAsync("+251912345678"));
    }

    [Fact]
    public async Task A_network_failure_means_dont_change_the_button()
    {
        var (client, _) = Make((_, _) => throw new HttpRequestException("down"));
        await Assert.ThrowsAsync<MarketplaceUnavailableException>(() => client.GetMerchantApplicationStatusAsync("+251912345678"));
    }

    [Fact]
    public async Task Without_a_configured_key_nothing_is_sent()
    {
        var (client, handler) = Make((_, _) => Json(HttpStatusCode.OK, "{}"), key: null);
        await Assert.ThrowsAsync<MarketplaceUnavailableException>(() => client.GetMerchantApplicationStatusAsync("+251912345678"));
        Assert.Null(handler.Request);
    }

    [Fact]
    public async Task Callback_is_a_POST_to_delivery_status_callback_with_the_inbound_key()
    {
        var (client, handler) = Make((_, _) => Json(HttpStatusCode.OK, """{"ok":true,"job_id":"j","status":"accepted","applied":true}"""));
        await client.SendDeliveryStatusAsync(new DeliveryStatusCallback { JobId = "j", Status = "delivered", DriverRef = "drv-1" });

        Assert.Equal($"{Base}/delivery-status-callback", handler.Request!.RequestUri!.ToString());
        Assert.Equal("Bearer " + ApiFactory.InboundKey, handler.Request.Headers.Authorization!.ToString());
        using var doc = JsonDocument.Parse(handler.Body!);
        Assert.Equal("j", doc.RootElement.GetProperty("job_id").GetString());
        Assert.Equal("delivered", doc.RootElement.GetProperty("status").GetString());
        Assert.False(doc.RootElement.TryGetProperty("eta_minutes", out _));
    }

    [Theory]
    [InlineData(HttpStatusCode.BadRequest)]
    [InlineData(HttpStatusCode.NotFound)]
    [InlineData(HttpStatusCode.Conflict)]
    [InlineData(HttpStatusCode.UnprocessableEntity)]
    public async Task Callback_4xx_is_not_retryable(HttpStatusCode code)
    {
        var (client, _) = Make((_, _) => Json(code, "{}"));
        var ex = await Assert.ThrowsAsync<MarketplaceRejectedException>(() => client.SendDeliveryStatusAsync(new DeliveryStatusCallback { JobId = "j", Status = "failed" }));
        Assert.Equal((int)code, ex.StatusCode);
    }

    [Theory]
    [InlineData(HttpStatusCode.ServiceUnavailable)]
    [InlineData(HttpStatusCode.InternalServerError)]
    public async Task Callback_5xx_is_retryable(HttpStatusCode code)
    {
        var (client, _) = Make((_, _) => Json(code, "{}"));
        await Assert.ThrowsAsync<MarketplaceUnavailableException>(() => client.SendDeliveryStatusAsync(new DeliveryStatusCallback { JobId = "j", Status = "failed" }));
    }

    // --- the /app route the Tolo app uses, with the marketplace stubbed ---

    private sealed class StubMarketplace(Func<string, Task<MerchantApplicationStatus>> status) : IMarketplaceClient
    {
        public List<string> Phones { get; } = [];

        public Task<MerchantApplicationStatus> GetMerchantApplicationStatusAsync(string verifiedPhone, CancellationToken ct = default)
        {
            Phones.Add(verifiedPhone);
            return status(verifiedPhone);
        }

        public Task SendDeliveryStatusAsync(DeliveryStatusCallback callback, CancellationToken ct = default) => Task.CompletedTask;
    }

    [Fact]
    public async Task App_merchant_status_asks_the_marketplace_about_the_verified_phone_and_nothing_else()
    {
        var stub = new StubMarketplace(p => Task.FromResult(new MerchantApplicationStatus { Phone = p, IsMerchant = true }));
        using var f = new ApiFactory(marketplace: stub);
        f.Customers.Add(new VerifiedCustomer("c1", "0912345678", "A"));

        using var req = new HttpRequestMessage(HttpMethod.Post, "/app/me/merchant-status") { Content = JsonContent.Create(new { phone = "+251999999999" }) };
        req.Headers.Add("X-Fake-Customer-Id", "c1");
        var r = await f.CreateClient().SendAsync(req);

        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        Assert.Equal(["+251912345678"], stub.Phones);
        var json = await r.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(json.GetProperty("is_merchant").GetBoolean());
    }

    [Fact]
    public async Task App_merchant_status_is_502_when_the_marketplace_fails()
    {
        var stub = new StubMarketplace(_ => throw new MarketplaceUnavailableException("down"));
        using var f = new ApiFactory(marketplace: stub);
        f.Customers.Add(new VerifiedCustomer("c1", "0912345678", "A"));

        using var req = new HttpRequestMessage(HttpMethod.Post, "/app/me/merchant-status");
        req.Headers.Add("X-Fake-Customer-Id", "c1");
        Assert.Equal(HttpStatusCode.BadGateway, (await f.CreateClient().SendAsync(req)).StatusCode);
    }

    [Fact]
    public async Task App_routes_are_401_without_a_customer_and_501_when_app_auth_is_not_configured()
    {
        using var f = new ApiFactory();
        Assert.Equal(HttpStatusCode.Unauthorized, (await f.CreateClient().PostAsync("/app/me/merchant-status", null)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await f.CreateClient().PostAsync("/app/me/login-code", null)).StatusCode);

        using var off = new ApiFactory(new() { ["TOLO_ALLOW_FAKE_APP_AUTH"] = "false" });
        Assert.Equal(HttpStatusCode.NotImplemented, (await off.CreateClient().PostAsync("/app/me/merchant-status", null)).StatusCode);
        Assert.Equal(HttpStatusCode.NotImplemented, (await off.CreateClient().PostAsync("/app/me/login-code", null)).StatusCode);
    }

    [Fact]
    public async Task A_code_issued_through_the_app_route_verifies_once_through_the_integration_route()
    {
        using var f = new ApiFactory();
        f.Customers.Add(new VerifiedCustomer("c1", "251912345678", "Abebe Kebede"));

        using var issue = new HttpRequestMessage(HttpMethod.Post, "/app/me/login-code");
        issue.Headers.Add("X-Fake-Customer-Id", "c1");
        var code = (await (await f.CreateClient().SendAsync(issue)).Content.ReadFromJsonAsync<JsonElement>()).GetProperty("code").GetString();

        var verify = await f.MarketplaceClient().PostAsJsonAsync("/integrations/tolo-marketplace/verify-code", new { code });
        Assert.True((await verify.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("valid").GetBoolean());
        var again = await f.MarketplaceClient().PostAsJsonAsync("/integrations/tolo-marketplace/verify-code", new { code });
        Assert.Equal("already_used", (await again.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("reason").GetString());
    }
}
