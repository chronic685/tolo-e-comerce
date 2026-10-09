using Tolo.Api.Auth;
using Tolo.Domain.Catalog;
using Tolo.Domain.Common;
using Tolo.Domain.Identity;
using Tolo.Domain.Merchants;

namespace Tolo.Api.Endpoints;

/// <summary>
/// The three audiences are three route areas of one app, each behind its own authorization policy, each calling the SAME domain modules.
/// What differs per area is only who may call and which shape the module returns; no business rule is repeated here.
/// </summary>
public static class AreaEndpoints
{
    public static void MapAreas(this IEndpointRouteBuilder app)
    {
        MapCustomer(app.MapGroup("/api/customer").RequireAuthorization(ToloBearer.CustomerArea).WithTags("Customer"));
        MapMerchant(app.MapGroup("/api/merchant").RequireAuthorization(ToloBearer.MerchantArea).WithTags("Merchant"));
        MapAdmin(app.MapGroup("/api/admin").RequireAuthorization(ToloBearer.AdminArea).WithTags("Admin"));
    }

    private static IResult Bad(QueryParsing q) => Results.Json(new { error = "Invalid query.", details = q.Errors }, statusCode: StatusCodes.Status400BadRequest);

    private static ToloPrincipal Who(HttpContext http) =>
        ToloBearer.FromClaims(http.User) ?? throw new InvalidOperationException("An authorized request has no principal.");

    // --- customer: public browsing. Anonymous callers are welcome; a signed-in staff or admin account is not a customer. ---
    private static void MapCustomer(RouteGroupBuilder g)
    {
        g.MapGet("/categories", async (CatalogModule catalog, CancellationToken ct) => Results.Ok(await catalog.CategoriesForCustomerAsync(ct)));

        g.MapGet("/merchants", async (HttpContext http, MerchantModule merchants, CancellationToken ct) =>
        {
            var q = new QueryParsing(http.Request.Query);
            var filter = q.Merchants();
            var page = q.Page();
            return q.Errors.Count > 0 ? Bad(q) : Results.Ok(await merchants.ListForCustomerAsync(filter, page, ct));
        });

        g.MapGet("/merchants/{id:guid}", async (Guid id, MerchantModule merchants, CancellationToken ct) =>
            await merchants.GetForCustomerAsync(id, ct) is { } m ? Results.Ok(m) : Results.NotFound());

        g.MapGet("/products", async (HttpContext http, CatalogModule catalog, CancellationToken ct) =>
        {
            var q = new QueryParsing(http.Request.Query);
            var filter = q.Products();
            var page = q.Page();
            return q.Errors.Count > 0 ? Bad(q) : Results.Ok(await catalog.ListForCustomerAsync(filter, page, ct));
        });

        g.MapGet("/products/{id:guid}", async (Guid id, CatalogModule catalog, CancellationToken ct) =>
            await catalog.GetForCustomerAsync(id, ct) is { } p ? Results.Ok(p) : Results.NotFound());
    }

    // --- merchant: the caller's own merchants only ---
    private static void MapMerchant(RouteGroupBuilder g)
    {
        g.MapGet("/merchants", async (HttpContext http, MerchantModule merchants, CancellationToken ct) =>
        {
            var q = new QueryParsing(http.Request.Query);
            var filter = q.Merchants();
            var page = q.Page();
            return q.Errors.Count > 0 ? Bad(q) : Results.Ok(await merchants.ListForMerchantAsync(Who(http), filter, page, ct));
        });

        g.MapGet("/merchants/{id:guid}", async (Guid id, HttpContext http, MerchantModule merchants, CancellationToken ct) =>
            await merchants.GetForMerchantAsync(Who(http), id, ct) is { } m ? Results.Ok(m) : Results.NotFound());

        g.MapGet("/products", async (HttpContext http, CatalogModule catalog, CancellationToken ct) =>
        {
            var q = new QueryParsing(http.Request.Query);
            var filter = q.Products();
            var page = q.Page();
            return q.Errors.Count > 0 ? Bad(q) : Results.Ok(await catalog.ListForMerchantAsync(Who(http), filter, page, ct));
        });

        g.MapGet("/products/{id:guid}", async (Guid id, HttpContext http, CatalogModule catalog, CancellationToken ct) =>
            await catalog.GetForMerchantAsync(Who(http), id, ct) is { } p ? Results.Ok(p) : Results.NotFound());
    }

    // --- admin: admin tiers, and staff holding the page (the module checks it) ---
    private static void MapAdmin(RouteGroupBuilder g)
    {
        g.MapGet("/categories", async (HttpContext http, CatalogModule catalog, CancellationToken ct) =>
            Results.Ok(await catalog.CategoriesForAdminAsync(Who(http), ct)));

        g.MapGet("/merchants", async (HttpContext http, MerchantModule merchants, CancellationToken ct) =>
        {
            var q = new QueryParsing(http.Request.Query);
            var filter = q.Merchants();
            var page = q.Page();
            return q.Errors.Count > 0 ? Bad(q) : Results.Ok(await merchants.ListForAdminAsync(Who(http), filter, page, ct));
        });

        g.MapGet("/merchants/{id:guid}", async (Guid id, HttpContext http, MerchantModule merchants, CancellationToken ct) =>
            await merchants.GetForAdminAsync(Who(http), id, ct) is { } m ? Results.Ok(m) : Results.NotFound());

        g.MapGet("/products", async (HttpContext http, CatalogModule catalog, CancellationToken ct) =>
        {
            var q = new QueryParsing(http.Request.Query);
            var filter = q.Products();
            var page = q.Page();
            return q.Errors.Count > 0 ? Bad(q) : Results.Ok(await catalog.ListForAdminAsync(Who(http), filter, page, ct));
        });

        g.MapGet("/products/{id:guid}", async (Guid id, HttpContext http, CatalogModule catalog, CancellationToken ct) =>
            await catalog.GetForAdminAsync(Who(http), id, ct) is { } p ? Results.Ok(p) : Results.NotFound());
    }
}
