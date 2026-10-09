using System.Net;
using Tolo.Domain.Identity;
using Tolo.Tests.Support;

namespace Tolo.Tests;

/// <summary>
/// Each API area rejects the other audiences' roles, before any data is touched (no database is configured here, so a request that
/// got past authorization would answer 503, which is how these tests tell "rejected" from "let through").
/// </summary>
public sealed class AreaIsolationTests
{
    private const string Customer = "/api/customer/merchants";
    private const string Merchant = "/api/merchant/merchants";
    private const string Admin = "/api/admin/merchants";

    private static readonly string[] AllAreas = [Customer, Merchant, Admin];

    private static async Task<HttpStatusCode> StatusAsync(HttpClient c, string path) => (await c.GetAsync(path)).StatusCode;

    [Fact]
    public async Task Anonymous_may_browse_the_customer_area_only()
    {
        using var f = new ApiFactory();
        var c = f.CreateClient();
        Assert.Equal(HttpStatusCode.ServiceUnavailable, await StatusAsync(c, Customer)); // let through to the (missing) database
        Assert.Equal(HttpStatusCode.Unauthorized, await StatusAsync(c, Merchant));
        Assert.Equal(HttpStatusCode.Unauthorized, await StatusAsync(c, Admin));
    }

    [Fact]
    public async Task A_plain_customer_gets_the_customer_area_and_is_refused_the_other_two()
    {
        using var f = new ApiFactory();
        var c = f.ClientFor(f.AddAccount([Roles.Customer]));
        Assert.Equal(HttpStatusCode.ServiceUnavailable, await StatusAsync(c, Customer));
        Assert.Equal(HttpStatusCode.Forbidden, await StatusAsync(c, Merchant));
        Assert.Equal(HttpStatusCode.Forbidden, await StatusAsync(c, Admin));
    }

    [Theory]
    [InlineData(Roles.MerchantOwner)]
    [InlineData(Roles.MerchantStaff)]
    public async Task A_merchant_member_gets_the_merchant_area_and_is_refused_admin(string role)
    {
        using var f = new ApiFactory();
        var c = f.ClientFor(f.AddAccount([Roles.Customer, role], merchants: [Guid.NewGuid()]));
        Assert.Equal(HttpStatusCode.ServiceUnavailable, await StatusAsync(c, Merchant));
        Assert.Equal(HttpStatusCode.Forbidden, await StatusAsync(c, Admin));
    }

    [Theory]
    [InlineData(Roles.Staff)]
    [InlineData(Roles.Admin)]
    [InlineData(Roles.SuperAdmin)]
    public async Task Staff_and_admins_get_the_admin_area_and_are_refused_the_customer_and_merchant_areas(string role)
    {
        using var f = new ApiFactory();
        var c = f.ClientFor(f.AddAccount([role], pages: ["merchants"]));
        Assert.Equal(HttpStatusCode.ServiceUnavailable, await StatusAsync(c, Admin));
        Assert.Equal(HttpStatusCode.Forbidden, await StatusAsync(c, Customer));
        Assert.Equal(HttpStatusCode.Forbidden, await StatusAsync(c, Merchant));
    }

    [Fact]
    public async Task A_staff_account_is_not_a_merchant_just_because_it_is_staff()
    {
        using var f = new ApiFactory();
        var c = f.ClientFor(f.AddAccount([Roles.Staff], pages: ["merchants", "products"]));
        Assert.Equal(HttpStatusCode.Forbidden, await StatusAsync(c, Merchant));
    }

    [Fact]
    public async Task Every_product_route_follows_the_same_isolation()
    {
        using var f = new ApiFactory();
        var customer = f.ClientFor(f.AddAccount([Roles.Customer]));
        Assert.Equal(HttpStatusCode.Forbidden, await StatusAsync(customer, "/api/merchant/products"));
        Assert.Equal(HttpStatusCode.Forbidden, await StatusAsync(customer, "/api/admin/products"));
        Assert.Equal(HttpStatusCode.Forbidden, await StatusAsync(customer, "/api/admin/categories"));
        Assert.Equal(HttpStatusCode.Forbidden, await StatusAsync(customer, $"/api/merchant/products/{Guid.NewGuid()}"));
        Assert.Equal(HttpStatusCode.Forbidden, await StatusAsync(customer, $"/api/admin/merchants/{Guid.NewGuid()}"));
    }

    [Fact]
    public async Task A_staff_account_without_the_page_is_forbidden_inside_the_admin_area()
    {
        using var f = new ApiFactory();
        var noPages = f.ClientFor(f.AddAccount([Roles.Staff], pages: ["orders"]));
        Assert.Equal(HttpStatusCode.Forbidden, await StatusAsync(noPages, Admin));
        Assert.Equal(HttpStatusCode.Forbidden, await StatusAsync(noPages, "/api/admin/products"));

        var merchantsOnly = f.ClientFor(f.AddAccount([Roles.Staff], pages: ["merchants"]));
        Assert.Equal(HttpStatusCode.ServiceUnavailable, await StatusAsync(merchantsOnly, Admin)); // page held: let through
        Assert.Equal(HttpStatusCode.Forbidden, await StatusAsync(merchantsOnly, "/api/admin/products"));
    }

    [Theory]
    [InlineData("garbage")]
    [InlineData("a.b.c")]
    public async Task A_bad_token_is_401_in_every_area_even_the_public_one(string token)
    {
        using var f = new ApiFactory();
        var c = f.ClientWithToken(token);
        foreach (var path in AllAreas) Assert.Equal(HttpStatusCode.Unauthorized, await StatusAsync(c, path));
    }

    [Fact]
    public async Task A_valid_token_for_an_unknown_or_suspended_account_is_401()
    {
        using var f = new ApiFactory();
        var unknown = f.ClientFor(Guid.NewGuid());
        foreach (var path in AllAreas) Assert.Equal(HttpStatusCode.Unauthorized, await StatusAsync(unknown, path));

        // An account with no roles (what a suspended profile resolves to) is refused too.
        var noRoles = f.ClientFor(f.AddAccount([]));
        foreach (var path in AllAreas) Assert.Equal(HttpStatusCode.Unauthorized, await StatusAsync(noRoles, path));
    }

    [Fact]
    public async Task Roles_come_from_the_database_not_from_the_token()
    {
        using var f = new ApiFactory();
        var id = f.AddAccount([Roles.Customer]);
        // A token claiming everything under the hood still resolves to the stored roles.
        var token = f.Tokens.Issue(id.ToString());
        var c = f.ClientWithToken(token);
        Assert.Equal(HttpStatusCode.Forbidden, await StatusAsync(c, Admin));
    }
}
