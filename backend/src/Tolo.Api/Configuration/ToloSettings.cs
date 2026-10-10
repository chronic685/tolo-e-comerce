namespace Tolo.Api.Configuration;

/// <summary>
/// All configuration comes from environment variables (see backend/.env.example). Nothing is read from appsettings,
/// so no value, secret or otherwise, can end up committed by accident.
/// </summary>
public sealed class ToloSettings
{
    /// <summary>DATABASE_URL: a Postgres URI or Npgsql connection string. Unset runs without a database; data routes answer 503.</summary>
    public string? DatabaseUrl { get; init; }

    /// <summary>TOLO_BACKEND_SHARED_KEY: bearer for the server-to-server /internal routes. Unset refuses every /internal call.</summary>
    public string? SharedKey { get; init; }

    /// <summary>TOLO_JWT_ISSUER, TOLO_JWT_AUDIENCE, TOLO_JWT_SIGNING_KEY, TOLO_JWT_JWKS_URL: how bearer tokens are verified. Assumption-based.</summary>
    public string? JwtIssuer { get; init; }

    public string? JwtAudience { get; init; }

    public string? JwtSigningKey { get; init; }

    public string? JwtJwksUrl { get; init; }

    /// <summary>TOLO_ENABLE_DEV_TOKENS: expose POST /dev/token. Honored only in the Development environment; anywhere else it stops startup.</summary>
    public bool EnableDevTokens { get; init; }

    /// <summary>TOLO_RATE_LIMIT_PER_MINUTE: requests per source IP per minute across the API. Default 120.</summary>
    public int RateLimitPerMinute { get; init; } = 120;

    /// <summary>TOLO_TRUST_FORWARDED_HEADERS: honor X-Forwarded-For. Only true behind a proxy that overwrites it.</summary>
    public bool TrustForwardedHeaders { get; init; }

    public static ToloSettings From(IConfiguration c) => new()
    {
        DatabaseUrl = Blank(c["DATABASE_URL"]),
        SharedKey = Blank(c["TOLO_BACKEND_SHARED_KEY"]),
        JwtIssuer = Blank(c["TOLO_JWT_ISSUER"]),
        JwtAudience = Blank(c["TOLO_JWT_AUDIENCE"]),
        JwtSigningKey = Blank(c["TOLO_JWT_SIGNING_KEY"]),
        JwtJwksUrl = Blank(c["TOLO_JWT_JWKS_URL"]),
        EnableDevTokens = Flag(c["TOLO_ENABLE_DEV_TOKENS"]),
        RateLimitPerMinute = Int(c["TOLO_RATE_LIMIT_PER_MINUTE"], 120),
        TrustForwardedHeaders = Flag(c["TOLO_TRUST_FORWARDED_HEADERS"]),
    };

    private static string? Blank(string? v) => string.IsNullOrWhiteSpace(v) ? null : v;

    private static int Int(string? v, int fallback) => int.TryParse(v, out var n) && n > 0 ? n : fallback;

    private static bool Flag(string? v) => string.Equals(v, "true", StringComparison.OrdinalIgnoreCase);
}
