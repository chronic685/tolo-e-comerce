using System.Text.Json.Serialization;

namespace Tolo.Domain.Contracts;

/// <summary>Marketplace response to merchant-application-status (docs/integration/tolo-app.md, "Bridge signal").</summary>
public sealed record MerchantApplicationStatus
{
    [JsonPropertyName("phone")] public required string Phone { get; init; }
    [JsonPropertyName("is_merchant")] public required bool IsMerchant { get; init; }
    [JsonPropertyName("application")] public ApplicationInfo? Application { get; init; }
}

public sealed record ApplicationInfo
{
    [JsonPropertyName("id")] public string? Id { get; init; }
    /// <summary>pending, approved or rejected.</summary>
    [JsonPropertyName("status")] public required string Status { get; init; }
    [JsonPropertyName("submitted_at")] public string? SubmittedAt { get; init; }
    [JsonPropertyName("reviewed_at")] public string? ReviewedAt { get; init; }
    /// <summary>The admin's reason when rejected; always null otherwise.</summary>
    [JsonPropertyName("note")] public string? Note { get; init; }
}
