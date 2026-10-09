using System.Text.Json;
using Tolo.Domain.Contracts;
using Tolo.Domain.Services;

namespace Tolo.Api.Endpoints;

/// <summary>
/// The routes the marketplace calls (docs/integration/tolo-app.md and delivery-handoff.md).
/// Authentication (TOLO_BACKEND_SHARED_KEY) happens in SharedKeyMiddleware, before anything here runs.
/// </summary>
public static class IntegrationEndpoints
{
    public const string Base = "/integrations/tolo-marketplace";

    public static void MapIntegrationEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup(Base).WithTags("Marketplace integration");

        // 200 for a valid code and for an invalid one ({valid:false, reason}); the marketplace treats both a non-2xx and valid:false as a failure.
        group.MapPost("/verify-code", async (HttpContext http, LoginCodeService codes, CancellationToken ct) =>
        {
            var body = await ReadBodyAsync<VerifyCodeRequest>(http, ct);
            if (body is null) return Results.Json(new { error = "A JSON body with a code is required." }, statusCode: StatusCodes.Status400BadRequest);
            return Results.Ok(await codes.VerifyAsync(body.Code, ct));
        }).RequireRateLimiting("verify-code").WithSummary("Redeem a one-time login code");

        group.MapPost("/delivery-jobs", async (HttpContext http, DeliveryJobIntake intake, CancellationToken ct) =>
        {
            var body = await ReadBodyAsync<DeliveryJobRequest>(http, ct);
            var outcome = await intake.ReceiveAsync(body, ct);
            return outcome.Accepted
                ? Results.Ok(new DeliveryJobResponse(true))
                : Results.Json(new { error = "Invalid delivery job.", details = outcome.Errors }, statusCode: StatusCodes.Status400BadRequest);
        }).WithSummary("Receive a delivery job (idempotent on job_id)");
    }

    internal static async Task<T?> ReadBodyAsync<T>(HttpContext http, CancellationToken ct) where T : class
    {
        try
        {
            return await http.Request.ReadFromJsonAsync<T>(ct);
        }
        catch (JsonException)
        {
            return null;
        }
        catch (InvalidOperationException)
        {
            return null;
        }
    }
}
