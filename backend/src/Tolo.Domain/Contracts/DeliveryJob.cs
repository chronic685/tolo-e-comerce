using System.Text.Json.Serialization;

namespace Tolo.Domain.Contracts;

/// <summary>
/// POST /integrations/tolo-marketplace/delivery-jobs body (docs/integration/delivery-handoff.md, "Job payload").
/// Members are nullable on purpose: validation reports what is wrong instead of failing JSON binding.
/// </summary>
public sealed record DeliveryJobRequest
{
    [JsonPropertyName("job_id")] public string? JobId { get; init; }
    [JsonPropertyName("order_number")] public string? OrderNumber { get; init; }
    [JsonPropertyName("pickup")] public JobLocation? Pickup { get; init; }
    [JsonPropertyName("dropoff")] public JobLocation? Dropoff { get; init; }
    [JsonPropertyName("items")] public List<JobItem>? Items { get; init; }
    [JsonPropertyName("amounts")] public JobAmounts? Amounts { get; init; }
    [JsonPropertyName("payment")] public JobPayment? Payment { get; init; }
}

public sealed record JobLocation
{
    [JsonPropertyName("name")] public string? Name { get; init; }
    [JsonPropertyName("address")] public string? Address { get; init; }
    [JsonPropertyName("latitude")] public double? Latitude { get; init; }
    [JsonPropertyName("longitude")] public double? Longitude { get; init; }
    [JsonPropertyName("phone")] public string? Phone { get; init; }
}

public sealed record JobItem
{
    [JsonPropertyName("name")] public string? Name { get; init; }
    [JsonPropertyName("quantity")] public int? Quantity { get; init; }
}

/// <summary>Components only. There is deliberately no total: the Tolo app computes what the driver collects.</summary>
public sealed record JobAmounts
{
    [JsonPropertyName("currency")] public string? Currency { get; init; }
    [JsonPropertyName("item_subtotal")] public decimal? ItemSubtotal { get; init; }
    [JsonPropertyName("discount")] public decimal? Discount { get; init; }
    [JsonPropertyName("delivery_fee")] public decimal? DeliveryFee { get; init; }
    [JsonPropertyName("rider_tip")] public decimal? RiderTip { get; init; }
}

public sealed record JobPayment
{
    /// <summary>cash_on_delivery or already_paid.</summary>
    [JsonPropertyName("method")] public string? Method { get; init; }
    [JsonPropertyName("driver_collects_cash")] public bool? DriverCollectsCash { get; init; }
}

/// <summary>Response to a delivery job POST: { "accepted": true }.</summary>
public sealed record DeliveryJobResponse([property: JsonPropertyName("accepted")] bool Accepted);

/// <summary>Status callback the Tolo side sends to the marketplace's delivery-status-callback function.</summary>
public sealed record DeliveryStatusCallback
{
    [JsonPropertyName("job_id")] public required string JobId { get; init; }
    /// <summary>accepted, picked_up, delivered or failed.</summary>
    [JsonPropertyName("status")] public required string Status { get; init; }
    [JsonPropertyName("driver_ref"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? DriverRef { get; init; }
    [JsonPropertyName("eta_minutes"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public int? EtaMinutes { get; init; }
    [JsonPropertyName("failure_reason"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? FailureReason { get; init; }
}
