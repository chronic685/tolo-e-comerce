using System.Security.Claims;
using System.Text.Encodings.Web;
using Microsoft.AspNetCore.Authentication;
using Microsoft.Extensions.Options;
using Tolo.Domain.Identity;

namespace Tolo.Api.Auth;

public static class ToloBearer
{
    public const string Scheme = "ToloBearer";

    public const string PageClaim = "tolo_page";
    public const string MerchantClaim = "tolo_merchant";

    // Authorization policies, one per API area.
    public const string CustomerArea = "customer-area";
    public const string MerchantArea = "merchant-area";
    public const string AdminArea = "admin-area";

    public static ClaimsPrincipal ToClaims(ToloPrincipal who)
    {
        var claims = new List<Claim> { new(ClaimTypes.NameIdentifier, who.UserId.ToString()) };
        claims.AddRange(who.Roles.Select(r => new Claim(ClaimTypes.Role, r)));
        claims.AddRange(who.Pages.Select(p => new Claim(PageClaim, p)));
        claims.AddRange(who.MerchantIds.Select(m => new Claim(MerchantClaim, m.ToString())));
        return new ClaimsPrincipal(new ClaimsIdentity(claims, Scheme, ClaimTypes.NameIdentifier, ClaimTypes.Role));
    }

    public static ToloPrincipal? FromClaims(ClaimsPrincipal user)
    {
        if (user.Identity?.IsAuthenticated != true || !Guid.TryParse(user.FindFirstValue(ClaimTypes.NameIdentifier), out var id)) return null;
        return new ToloPrincipal
        {
            UserId = id,
            Roles = user.FindAll(ClaimTypes.Role).Select(c => c.Value).ToHashSet(),
            Pages = user.FindAll(PageClaim).Select(c => c.Value).ToHashSet(),
            MerchantIds = user.FindAll(MerchantClaim).Select(c => Guid.Parse(c.Value)).ToHashSet(),
        };
    }
}

/// <summary>
/// Bearer authentication through the IIdentityProvider seam: verify the token, map it to an account, load that account's roles.
/// No header is anonymous; a bad token, an unknown account or an inactive account is a 401.
/// </summary>
public sealed class ToloBearerHandler(
    IOptionsMonitor<AuthenticationSchemeOptions> options,
    ILoggerFactory logger,
    UrlEncoder encoder,
    IIdentityProvider identity,
    IPrincipalResolver resolver) : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
{
    protected override async Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        var header = Request.Headers.Authorization.ToString();
        if (header.Length == 0) return AuthenticateResult.NoResult();
        if (!header.StartsWith("Bearer ", StringComparison.Ordinal)) return AuthenticateResult.Fail("Unsupported scheme.");

        var verified = await identity.ValidateAsync(header["Bearer ".Length..].Trim(), Context.RequestAborted);
        if (verified is null) return AuthenticateResult.Fail("Invalid token.");

        var who = await resolver.ResolveAsync(verified, Context.RequestAborted);
        if (who is null || who.Roles.Count == 0) return AuthenticateResult.Fail("No active account.");

        return AuthenticateResult.Success(new AuthenticationTicket(ToloBearer.ToClaims(who), Scheme.Name));
    }
}
