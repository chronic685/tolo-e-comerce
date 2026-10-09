using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using Tolo.Tests.Support;

namespace Tolo.Tests.Contract;

// docs/integration/delivery-handoff.md, "Job payload (marketplace -> Tolo Delivery app)".
public sealed class DeliveryJobContractTests
{
    private const string Path = "/integrations/tolo-marketplace/delivery-jobs";

    /// <summary>The documented example payload, verbatim.</summary>
    public const string DocumentedJson = """
        {
          "job_id": "5b0c0f6e-6a53-4c0e-9d57-0f1d3a9d1e11",
          "order_number": "TL-1042",
          "pickup": { "name": "Abebe's Kitchen", "address": "Bole Rd, Addis Ababa", "latitude": 9.01, "longitude": 38.76, "phone": "+251911000001" },
          "dropoff": { "name": "Sara T.", "address": "Piassa, Addis Ababa", "latitude": 9.03, "longitude": 38.75, "phone": "+251911000002" },
          "items": [ { "name": "Doro Wat", "quantity": 2 }, { "name": "Injera pack", "quantity": 1 } ],
          "amounts": { "currency": "ETB", "item_subtotal": 450, "discount": 0, "delivery_fee": 60, "rider_tip": 0 },
          "payment": { "method": "cash_on_delivery", "driver_collects_cash": true }
        }
        """;

    private static JsonObject Payload() => JsonNode.Parse(DocumentedJson)!.AsObject();

    private static Task<HttpResponseMessage> PostAsync(HttpClient c, JsonObject body) =>
        c.PostAsync(Path, new StringContent(body.ToJsonString(), System.Text.Encoding.UTF8, "application/json"));

    [Fact]
    public async Task Documented_payload_is_accepted_with_exactly_accepted_true()
    {
        using var f = new ApiFactory();
        var r = await PostAsync(f.MarketplaceClient(), Payload());

        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        Assert.Equal("""{"accepted":true}""", await r.Content.ReadAsStringAsync());
        Assert.Single(f.Jobs.Jobs);
    }

    [Fact]
    public async Task A_repeat_of_the_same_job_id_returns_the_same_success_and_creates_no_second_job()
    {
        using var f = new ApiFactory();
        var c = f.MarketplaceClient();
        var first = await (await PostAsync(c, Payload())).Content.ReadAsStringAsync();
        var second = await PostAsync(c, Payload());

        Assert.Equal(HttpStatusCode.OK, second.StatusCode);
        Assert.Equal(first, await second.Content.ReadAsStringAsync());
        Assert.Single(f.Jobs.Jobs);
    }

    [Fact]
    public async Task Paid_online_job_with_a_null_pickup_phone_and_coordinates_is_accepted()
    {
        using var f = new ApiFactory();
        var body = Payload();
        body["pickup"]!["phone"] = null;
        body["pickup"]!["latitude"] = null;
        body["pickup"]!["longitude"] = null;
        body["payment"] = new JsonObject { ["method"] = "already_paid", ["driver_collects_cash"] = false };

        Assert.Equal(HttpStatusCode.OK, (await PostAsync(f.MarketplaceClient(), body)).StatusCode);
    }

    [Fact]
    public async Task The_dropoff_phone_may_arrive_in_any_common_format()
    {
        using var f = new ApiFactory();
        var body = Payload();
        body["dropoff"]!["phone"] = "0911 00-0002";
        Assert.Equal(HttpStatusCode.OK, (await PostAsync(f.MarketplaceClient(), body)).StatusCode);
    }

    public static TheoryData<string, Action<JsonObject>> Invalid => new()
    {
        { "no job_id", b => b.Remove("job_id") },
        { "job_id not a uuid", b => b["job_id"] = "TL-1042" },
        { "no order_number", b => b["order_number"] = " " },
        { "no pickup", b => b.Remove("pickup") },
        { "no dropoff", b => b.Remove("dropoff") },
        { "dropoff without a phone (a job is never sent without one)", b => b["dropoff"]!["phone"] = null },
        { "dropoff phone not Ethiopian mobile", b => b["dropoff"]!["phone"] = "+14155550100" },
        { "dropoff with neither address nor coordinates", b => { b["dropoff"]!["address"] = null; b["dropoff"]!["latitude"] = null; b["dropoff"]!["longitude"] = null; } },
        { "no items", b => b["items"] = new JsonArray() },
        { "item quantity 0", b => b["items"]![0]!["quantity"] = 0 },
        { "currency not ETB", b => b["amounts"]!["currency"] = "USD" },
        { "negative delivery fee", b => b["amounts"]!["delivery_fee"] = -1 },
        { "missing rider_tip", b => b["amounts"]!.AsObject().Remove("rider_tip") },
        { "unknown payment method", b => b["payment"]!["method"] = "card" },
        { "cash_on_delivery with driver_collects_cash false", b => b["payment"]!["driver_collects_cash"] = false },
        { "no payment", b => b.Remove("payment") },
    };

    [Theory]
    [MemberData(nameof(Invalid))]
    public async Task Invalid_jobs_are_400_and_nothing_is_stored(string _, Action<JsonObject> break_)
    {
        using var f = new ApiFactory();
        var body = Payload();
        break_(body);

        var r = await PostAsync(f.MarketplaceClient(), body);
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
        Assert.Empty(f.Jobs.Jobs);
    }

    [Fact]
    public async Task The_payload_has_no_total_and_the_endpoint_does_not_invent_one()
    {
        using var f = new ApiFactory();
        await PostAsync(f.MarketplaceClient(), Payload());
        var amounts = JsonNode.Parse(JsonSerializer.Serialize(f.Jobs.Jobs.Single()))!["amounts"]!.AsObject();
        Assert.Equal(["currency", "delivery_fee", "discount", "item_subtotal", "rider_tip"], amounts.Select(p => p.Key).Order().ToArray());
    }

    [Fact]
    public async Task Malformed_json_is_400()
    {
        using var f = new ApiFactory();
        var r = await f.MarketplaceClient().PostAsync(Path, new StringContent("{", System.Text.Encoding.UTF8, "application/json"));
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
    }

    [Fact]
    public async Task Status_callback_body_matches_the_documented_fields()
    {
        var cb = new Tolo.Domain.Contracts.DeliveryStatusCallback { JobId = "5b0c", Status = "accepted", DriverRef = "drv-8841", EtaMinutes = 25 };
        var json = JsonSerializer.Serialize(cb);
        Assert.Equal("""{"job_id":"5b0c","status":"accepted","driver_ref":"drv-8841","eta_minutes":25}""", json);
        await Task.CompletedTask;
    }
}
