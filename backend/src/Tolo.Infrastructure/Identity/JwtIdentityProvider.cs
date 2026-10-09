using System.Text;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;
using Tolo.Domain.Identity;

namespace Tolo.Infrastructure.Identity;

public sealed class JwtOptions
{
    /// <summary>TOLO_JWT_ISSUER. Required: a token with another issuer is rejected.</summary>
    public string? Issuer { get; set; }

    /// <summary>TOLO_JWT_AUDIENCE. Required: a token for another audience is rejected.</summary>
    public string? Audience { get; set; }

    /// <summary>TOLO_JWT_SIGNING_KEY: shared secret for HS256 tokens, used as UTF-8 bytes (how Supabase's JWT secret works too).</summary>
    public string? SigningKey { get; set; }

    /// <summary>TOLO_JWT_JWKS_URL: public keys for asymmetric tokens (RS256, ES256). Fetched over HTTPS and cached.</summary>
    public string? JwksUrl { get; set; }

    public bool IsConfigured =>
        !string.IsNullOrWhiteSpace(Issuer) && !string.IsNullOrWhiteSpace(Audience)
        && (!string.IsNullOrWhiteSpace(SigningKey) || !string.IsNullOrWhiteSpace(JwksUrl));
}

/// <summary>
/// Verifies bearer tokens against env-configured issuer, audience and keys. ASSUMPTION: Tolo issues standard JWTs with the user in
/// "sub" and, optionally, a verified phone in "phone_number" or "phone". None of that is confirmed by Tolo's developer yet
/// (docs/backend/tolo-schema-questions.md). Until <see cref="JwtOptions.IsConfigured"/> every token is rejected.
/// </summary>
public sealed class JwtIdentityProvider(JwtOptions options, HttpClient http, TimeProvider clock) : IIdentityProvider, IDisposable
{
    private static readonly string[] SymmetricAlgorithms = [SecurityAlgorithms.HmacSha256];
    private static readonly string[] AsymmetricAlgorithms = [SecurityAlgorithms.RsaSha256, SecurityAlgorithms.EcdsaSha256];

    private readonly SemaphoreSlim _jwksGate = new(1, 1);
    private IList<SecurityKey> _jwksKeys = [];
    private DateTimeOffset _jwksFetchedAt = DateTimeOffset.MinValue;

    public void Dispose() => _jwksGate.Dispose();

    public async Task<TokenIdentity?> ValidateAsync(string token, CancellationToken ct = default)
    {
        if (!options.IsConfigured || string.IsNullOrWhiteSpace(token)) return null;

        var keys = new List<SecurityKey>();
        var algorithms = new List<string>();
        if (!string.IsNullOrWhiteSpace(options.SigningKey))
        {
            keys.Add(new SymmetricSecurityKey(Encoding.UTF8.GetBytes(options.SigningKey)));
            algorithms.AddRange(SymmetricAlgorithms);
        }

        if (!string.IsNullOrWhiteSpace(options.JwksUrl))
        {
            keys.AddRange(await JwksAsync(ct));
            algorithms.AddRange(AsymmetricAlgorithms);
        }

        var parameters = new TokenValidationParameters
        {
            ValidIssuer = options.Issuer,
            ValidAudience = options.Audience,
            IssuerSigningKeys = keys,
            ValidAlgorithms = algorithms,
            ValidateIssuer = true,
            ValidateAudience = true,
            ValidateLifetime = true,
            RequireSignedTokens = true,
            RequireExpirationTime = true,
            ClockSkew = TimeSpan.FromSeconds(30),
            LifetimeValidator = (nbf, exp, _, _) =>
                exp is not null && exp.Value > clock.GetUtcNow().UtcDateTime - TimeSpan.FromSeconds(30)
                && (nbf is null || nbf.Value <= clock.GetUtcNow().UtcDateTime + TimeSpan.FromSeconds(30)),
        };

        var result = await new JsonWebTokenHandler().ValidateTokenAsync(token, parameters);
        if (!result.IsValid || result.SecurityToken is not JsonWebToken jwt) return null;

        var subject = jwt.Subject;
        if (string.IsNullOrWhiteSpace(subject)) return null;
        return new TokenIdentity(subject, Claim(jwt, "phone_number") ?? Claim(jwt, "phone"));
    }

    private static string? Claim(JsonWebToken jwt, string type) =>
        jwt.TryGetPayloadValue<string>(type, out var v) && !string.IsNullOrWhiteSpace(v) ? v : null;

    private async Task<IList<SecurityKey>> JwksAsync(CancellationToken ct)
    {
        if (clock.GetUtcNow() - _jwksFetchedAt < TimeSpan.FromMinutes(10)) return _jwksKeys;
        await _jwksGate.WaitAsync(ct);
        try
        {
            if (clock.GetUtcNow() - _jwksFetchedAt < TimeSpan.FromMinutes(10)) return _jwksKeys;
            try
            {
                var json = await http.GetStringAsync(options.JwksUrl, ct);
                _jwksKeys = new JsonWebKeySet(json).GetSigningKeys();
                _jwksFetchedAt = clock.GetUtcNow();
            }
            catch (HttpRequestException)
            {
                // Keep serving the last good keys; with none, tokens simply fail to verify.
            }
        }
        finally
        {
            _jwksGate.Release();
        }

        return _jwksKeys;
    }
}
