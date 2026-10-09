using System.Security.Cryptography;
using System.Text;

namespace Tolo.Api.Middleware;

public sealed record SharedKeyOptions(string PathPrefix, string? Key);

/// <summary>
/// Bearer-key gate for the server-to-server routes, same behaviour as supabase/functions/_shared/inbound_auth.ts:
/// no key configured refuses everything with 503 (an empty bearer is never accepted); a wrong or missing key is 401.
/// The comparison is constant-time and independent of length.
/// </summary>
public sealed class SharedKeyMiddleware(RequestDelegate next, SharedKeyOptions options)
{
    public async Task InvokeAsync(HttpContext context)
    {
        if (!context.Request.Path.StartsWithSegments(options.PathPrefix, StringComparison.OrdinalIgnoreCase))
        {
            await next(context);
            return;
        }

        if (string.IsNullOrEmpty(options.Key))
        {
            context.Response.StatusCode = StatusCodes.Status503ServiceUnavailable;
            await context.Response.WriteAsJsonAsync(new { error = "Not configured." });
            return;
        }

        if (!BearerMatches(context.Request.Headers.Authorization.ToString(), options.Key))
        {
            context.Response.StatusCode = StatusCodes.Status401Unauthorized;
            await context.Response.WriteAsJsonAsync(new { error = "Unauthorized." });
            return;
        }

        await next(context);
    }

    /// <summary>Compares fixed-length SHA-256 digests with FixedTimeEquals, so neither content nor length leaks through timing.</summary>
    public static bool BearerMatches(string authorizationHeader, string expectedKey)
    {
        if (authorizationHeader.Length == 0) return false;
        var given = SHA256.HashData(Encoding.UTF8.GetBytes(authorizationHeader));
        var wanted = SHA256.HashData(Encoding.UTF8.GetBytes("Bearer " + expectedKey));
        return CryptographicOperations.FixedTimeEquals(given, wanted);
    }
}
