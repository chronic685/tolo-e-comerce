using System.Text.Json.Serialization;

namespace Tolo.Domain.Contracts;

/// <summary>POST /integrations/tolo-marketplace/verify-code body. docs/integration/tolo-app.md.</summary>
public sealed record VerifyCodeRequest([property: JsonPropertyName("code")] string? Code);

/// <summary>
/// Response to verify-code. Valid: { valid, phone, name }. Invalid: { valid:false, reason }.
/// Null members are omitted so each case matches the documented shape exactly.
/// </summary>
public sealed record VerifyCodeResponse
{
    [JsonPropertyName("valid")] public bool Valid { get; init; }
    [JsonPropertyName("phone"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? Phone { get; init; }
    [JsonPropertyName("name"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? Name { get; init; }
    [JsonPropertyName("reason"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? Reason { get; init; }

    public static VerifyCodeResponse Ok(string phone, string name) => new() { Valid = true, Phone = phone, Name = name };

    public static VerifyCodeResponse Rejected(string reason) => new() { Valid = false, Reason = reason };
}

public static class VerifyCodeReasons
{
    public const string InvalidCode = "invalid_code";
    public const string ExpiredCode = "expired_code";
    public const string AlreadyUsed = "already_used";
}
