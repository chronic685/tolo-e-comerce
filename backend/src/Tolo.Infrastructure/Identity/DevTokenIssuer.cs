using System.Text;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace Tolo.Infrastructure.Identity;

/// <summary>
/// Signs HS256 tokens that <see cref="JwtIdentityProvider"/> accepts when it is configured with the same issuer, audience and key.
/// For tests and local development ONLY. The API exposes it through /dev/token solely when TOLO_ENABLE_DEV_TOKENS=true and the
/// environment is Development; it is never wired up otherwise.
/// </summary>
public sealed class DevTokenIssuer(JwtOptions options, TimeProvider clock)
{
    public string Issue(string subject, string? phone = null, TimeSpan? lifetime = null)
    {
        if (string.IsNullOrWhiteSpace(options.SigningKey) || string.IsNullOrWhiteSpace(options.Issuer) || string.IsNullOrWhiteSpace(options.Audience))
            throw new InvalidOperationException("The dev token issuer needs TOLO_JWT_SIGNING_KEY, TOLO_JWT_ISSUER and TOLO_JWT_AUDIENCE.");

        var now = clock.GetUtcNow().UtcDateTime;
        var claims = new Dictionary<string, object> { ["sub"] = subject };
        if (phone is not null) claims["phone_number"] = phone;

        return new JsonWebTokenHandler().CreateToken(new SecurityTokenDescriptor
        {
            Issuer = options.Issuer,
            Audience = options.Audience,
            IssuedAt = now,
            NotBefore = now,
            Expires = now + (lifetime ?? TimeSpan.FromHours(1)),
            Claims = claims,
            SigningCredentials = new SigningCredentials(new SymmetricSecurityKey(Encoding.UTF8.GetBytes(options.SigningKey)), SecurityAlgorithms.HmacSha256),
        });
    }
}
