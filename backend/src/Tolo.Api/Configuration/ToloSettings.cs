namespace Tolo.Api.Configuration;

/// <summary>
/// All configuration comes from environment variables (see backend/.env.example). Nothing is read from appsettings,
/// so no value, secret or otherwise, can end up committed by accident.
/// </summary>
public sealed class ToloSettings
{
    /// <summary>TOLO_BACKEND_SHARED_KEY: bearer the marketplace sends TO this backend. Unset refuses every integration call.</summary>
    public string? SharedKey { get; init; }

    /// <summary>TOLO_BACKEND_INBOUND_KEY: bearer this backend sends TO the marketplace.</summary>
    public string? InboundKey { get; init; }

    /// <summary>MARKETPLACE_FUNCTIONS_URL: base URL of the marketplace's Edge Functions (.../functions/v1).</summary>
    public string? MarketplaceFunctionsUrl { get; init; }

    /// <summary>DATABASE_URL: a Postgres URI or Npgsql connection string. Unset runs without a database (health/ready reports it).</summary>
    public string? DatabaseUrl { get; init; }

    /// <summary>TOLO_LOGIN_CODE_TTL_SECONDS: how long a login code lives. Default 180 (the contract says "a few minutes").</summary>
    public int LoginCodeTtlSeconds { get; init; } = 180;

    /// <summary>TOLO_RATE_LIMIT_PER_MINUTE: requests per source IP per minute across the API. Default 120.</summary>
    public int RateLimitPerMinute { get; init; } = 120;

    /// <summary>TOLO_VERIFY_CODE_RATE_LIMIT_PER_MINUTE: stricter limit on verify-code (guessing codes). Default 30.</summary>
    public int VerifyCodeRateLimitPerMinute { get; init; } = 30;

    /// <summary>TOLO_TRUST_FORWARDED_HEADERS: honor X-Forwarded-For. Only true behind a proxy that overwrites it.</summary>
    public bool TrustForwardedHeaders { get; init; }

    /// <summary>TOLO_ALLOW_FAKE_APP_AUTH: accept the X-Fake-Customer-Id header as the signed-in Tolo customer. Local dev and tests only.</summary>
    public bool AllowFakeAppAuth { get; init; }

    public static ToloSettings From(IConfiguration c) => new()
    {
        SharedKey = Blank(c["TOLO_BACKEND_SHARED_KEY"]),
        InboundKey = Blank(c["TOLO_BACKEND_INBOUND_KEY"]),
        MarketplaceFunctionsUrl = Blank(c["MARKETPLACE_FUNCTIONS_URL"]),
        DatabaseUrl = Blank(c["DATABASE_URL"]),
        LoginCodeTtlSeconds = Int(c["TOLO_LOGIN_CODE_TTL_SECONDS"], 180),
        RateLimitPerMinute = Int(c["TOLO_RATE_LIMIT_PER_MINUTE"], 120),
        VerifyCodeRateLimitPerMinute = Int(c["TOLO_VERIFY_CODE_RATE_LIMIT_PER_MINUTE"], 30),
        TrustForwardedHeaders = Flag(c["TOLO_TRUST_FORWARDED_HEADERS"]),
        AllowFakeAppAuth = Flag(c["TOLO_ALLOW_FAKE_APP_AUTH"]),
    };

    private static string? Blank(string? v) => string.IsNullOrWhiteSpace(v) ? null : v;

    private static int Int(string? v, int fallback) => int.TryParse(v, out var n) && n > 0 ? n : fallback;

    private static bool Flag(string? v) => string.Equals(v, "true", StringComparison.OrdinalIgnoreCase);
}
