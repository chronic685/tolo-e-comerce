using Microsoft.Extensions.Diagnostics.HealthChecks;
using Tolo.Api.Configuration;
using Tolo.Infrastructure.Identity;
using Tolo.Infrastructure.Persistence;

namespace Tolo.Api.Endpoints;

public static class SystemEndpoints
{
    public static void MapSystem(this IEndpointRouteBuilder app, ToloSettings settings, bool isDevelopment)
    {
        // Liveness: the process is up. Touches nothing else, so a database outage never restarts the container.
        app.MapGet("/health", () => Results.Ok(new { status = "ok" })).WithTags("Health").WithSummary("Liveness");

        // Readiness: dependencies. With no DATABASE_URL configured there is nothing to check and it reports that.
        app.MapGet("/health/ready", async (HealthCheckService health, CancellationToken ct) =>
        {
            var report = await health.CheckHealthAsync(r => r.Tags.Contains("ready"), ct);
            var ok = report.Status == HealthStatus.Healthy;
            var body = new { status = ok ? "ok" : "unavailable", database = settings.DatabaseUrl is null ? "not_configured" : ok ? "ok" : "unavailable" };
            return ok ? Results.Ok(body) : Results.Json(body, statusCode: StatusCodes.Status503ServiceUnavailable);
        }).WithTags("Health").WithSummary("Readiness");

        // Server-to-server channel for Tolo's own backend (webhooks and calls, once their developer defines them). Behind the shared key.
        app.MapGet("/internal/ping", () => Results.Ok(new { status = "ok" })).WithTags("Internal").WithSummary("Shared-key check");

        if (settings.EnableDevTokens)
        {
            if (!isDevelopment) throw new InvalidOperationException("TOLO_ENABLE_DEV_TOKENS is only allowed in the Development environment.");
            app.MapPost("/dev/token", (DevTokenIssuer issuer, string sub, string? phone) => Results.Ok(new { token = issuer.Issue(sub, phone) }))
                .WithTags("Development").WithSummary("Issues a local test token (development only)");
        }
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
