using Microsoft.Extensions.Diagnostics.HealthChecks;
using Tolo.Api.Configuration;
using Tolo.Infrastructure.Persistence;

namespace Tolo.Api.Endpoints;

public static class HealthEndpoints
{
    public static void MapHealthEndpoints(this IEndpointRouteBuilder app)
    {
        // Liveness: the process is up. Touches nothing else, so a database outage never restarts the container.
        app.MapGet("/health", () => Results.Ok(new { status = "ok" }))
            .WithTags("Health").WithSummary("Liveness");

        // Readiness: dependencies. With no DATABASE_URL configured there is nothing to check and it reports that.
        app.MapGet("/health/ready", async (HealthCheckService health, ToloSettings settings, CancellationToken ct) =>
        {
            var report = await health.CheckHealthAsync(r => r.Tags.Contains("ready"), ct);
            var body = new
            {
                status = report.Status == HealthStatus.Healthy ? "ok" : "unavailable",
                database = settings.DatabaseUrl is null ? "not_configured" : report.Status == HealthStatus.Healthy ? "ok" : "unavailable",
            };
            return report.Status == HealthStatus.Healthy ? Results.Ok(body) : Results.Json(body, statusCode: StatusCodes.Status503ServiceUnavailable);
        }).WithTags("Health").WithSummary("Readiness");
    }
}

/// <summary>SELECT 1 through EF Core. Registered only when DATABASE_URL is set.</summary>
public sealed class DatabaseHealthCheck(ToloDbContext db) : IHealthCheck
{
    public async Task<HealthCheckResult> CheckHealthAsync(HealthCheckContext context, CancellationToken cancellationToken = default)
    {
        try
        {
            return await db.Database.CanConnectAsync(cancellationToken) ? HealthCheckResult.Healthy() : HealthCheckResult.Unhealthy();
        }
        catch (Exception ex)
        {
            return HealthCheckResult.Unhealthy(exception: ex);
        }
    }
}
