using Tolo.Api.Auth;
using Tolo.Domain;
using Tolo.Domain.Abstractions;
using Tolo.Domain.Services;

namespace Tolo.Api.Endpoints;

/// <summary>
/// Routes the Tolo app itself calls with its customer's session. The phone used is ALWAYS the one the Tolo customer
/// directory holds for the authenticated customer, never a value from the request, so a caller cannot ask about, or
/// log in as, someone else's number.
/// TODO(tolo-auth): both routes answer 501 until the app's real authentication is wired in (see IAppAuthenticator).
/// </summary>
public static class AppEndpoints
{
    public static void MapAppEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/app/me").WithTags("Tolo app");

        // Hands the signed-in customer a one-time code to open the marketplace WebView with (.../auth/handoff?code=...).
        group.MapPost("/login-code", async (HttpContext http, IAppAuthenticator auth, LoginCodeService codes, ICustomerDirectory customers, Tolo.Api.Configuration.ToloSettings settings, CancellationToken ct) =>
        {
            if (!auth.IsConfigured) return NotImplemented();
            var customerId = auth.CustomerId(http);
            if (customerId is null || await customers.FindAsync(customerId, ct) is null) return Results.Json(new { error = "Unauthorized." }, statusCode: StatusCodes.Status401Unauthorized);
            var code = await codes.IssueAsync(customerId, ct);
            return Results.Ok(new { code, expires_in = settings.LoginCodeTtlSeconds });
        }).WithSummary("Issue a one-time marketplace login code");

        // The "show the Merchant button?" pull. Any marketplace failure is a 502, which the app reads as "don't change the button".
        group.MapPost("/merchant-status", async (HttpContext http, IAppAuthenticator auth, ICustomerDirectory customers, IMarketplaceClient marketplace, CancellationToken ct) =>
        {
            if (!auth.IsConfigured) return NotImplemented();
            var customerId = auth.CustomerId(http);
            var customer = customerId is null ? null : await customers.FindAsync(customerId, ct);
            var phone = PhoneNumber.NormalizeEthiopian(customer?.Phone);
            if (phone is null) return Results.Json(new { error = "Unauthorized." }, statusCode: StatusCodes.Status401Unauthorized);

            try
            {
                return Results.Ok(await marketplace.GetMerchantApplicationStatusAsync(phone, ct));
            }
            catch (MarketplaceUnavailableException)
            {
                return Results.Json(new { error = "Marketplace unavailable." }, statusCode: StatusCodes.Status502BadGateway);
            }
        }).WithSummary("Merchant-button state from the marketplace");
    }

    private static IResult NotImplemented() =>
        Results.Json(new { error = "Tolo app authentication is not configured." }, statusCode: StatusCodes.Status501NotImplemented);
}
