using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Tolo.Domain.Abstractions;
using Tolo.Domain.Identity;
using Tolo.Domain.Services;
using Tolo.Infrastructure.Persistence;
using Tolo.Tests.Support;

namespace Tolo.Tests.Database;

/// <summary>Reads through the real EF readers against the real schema (every migration applied to a throwaway local database).</summary>
public sealed class DbApiTests
{
    private static readonly string[] PrivateKeys = ["\"phone\"", "\"email\"", "\"owner_", "\"business_registration", "\"rejection_reason\"", "\"suspension_reason\""];
    private static readonly string[] Secrets = [DbSeed.SecretPhone, DbSeed.SecretEmail, DbSeed.SecretOwner, DbSeed.SecretRegistration, "internal note"];

    private static async Task<(DbSeed seed, ApiFactory api)> SetupAsync()
    {
        var db = await TestDatabase.GetAsync();
        return (new DbSeed(db.ConnectionString), new ApiFactory(databaseUrl: db.ConnectionString));
    }

    private static async Task<JsonElement> JsonAsync(HttpClient c, string path, HttpStatusCode expected = HttpStatusCode.OK)
    {
        var r = await c.GetAsync(path);
        Assert.True(r.StatusCode == expected, $"{path} -> {(int)r.StatusCode}: {await r.Content.ReadAsStringAsync()}");
        return expected == HttpStatusCode.OK ? await r.Content.ReadFromJsonAsync<JsonElement>() : default;
    }

    private static void AssertNothingPrivate(string body)
    {
        foreach (var s in Secrets) Assert.DoesNotContain(s, body, StringComparison.Ordinal);
        foreach (var k in PrivateKeys) Assert.DoesNotContain(k, body, StringComparison.Ordinal);
    }

    private static Guid[] Ids(JsonElement page, string property = "id") =>
        page.GetProperty("items").EnumerateArray().Select(i => i.GetProperty(property).GetGuid()).ToArray();

    // ---------------------------------------------------------------- accounts and roles

    [LocalDbFact]
    public async Task Roles_are_read_from_profiles_merchants_and_merchant_staff()
    {
        var (seed, api) = await SetupAsync();
        using var _ = api;
        var db = await TestDatabase.GetAsync();
        await using var ds = ToloDbContext.CreateDataSource(db.ConnectionString);
        await using var ctx = new ToloDbContext(ToloDbContext.Options(ds));
        var dir = new EfAccountDirectory(ctx);

        var owner = await seed.UserAsync();
        var merchant = await seed.MerchantAsync(owner, "Roles Shop");
        var worker = await seed.UserAsync();
        await seed.StaffAsync(merchant, worker);
        var staff = await seed.UserAsync("tolo_ops", pages: ["merchants", "orders"]);
        var admin = await seed.UserAsync("customer", adminTier: "admin");
        var superAdmin = await seed.SuperAdminAsync();
        var plain = await seed.UserAsync();

        var o = (await dir.LoadAsync(owner))!;
        Assert.True(o.Is(Roles.Customer) && o.Is(Roles.MerchantOwner) && !o.Is(Roles.MerchantStaff));
        Assert.Equal([merchant], o.MerchantIds);

        var w = (await dir.LoadAsync(worker))!;
        Assert.True(w.Is(Roles.Customer) && w.Is(Roles.MerchantStaff) && !w.Is(Roles.MerchantOwner));
        Assert.True(w.IsMemberOf(merchant));

        var s = (await dir.LoadAsync(staff))!;
        Assert.True(s.Is(Roles.Staff) && !s.Is(Roles.Customer));
        Assert.True(s.HasAdminPage("merchants") && !s.HasAdminPage("products"));

        var a = (await dir.LoadAsync(admin))!;
        Assert.True(a.IsAdmin && !a.Is(Roles.SuperAdmin) && !a.Is(Roles.Customer));
        Assert.True(a.HasAdminPage("products"));

        var sa = (await dir.LoadAsync(superAdmin))!;
        Assert.True(sa.Is(Roles.SuperAdmin) && sa.Is(Roles.Admin));

        var p = (await dir.LoadAsync(plain))!;
        Assert.Equal([Roles.Customer], p.Roles);
        Assert.Empty(p.MerchantIds);
    }

    [LocalDbFact]
    public async Task A_suspended_or_unknown_account_has_no_principal()
    {
        var (seed, api) = await SetupAsync();
        using var _ = api;
        var db = await TestDatabase.GetAsync();
        await using var ds = ToloDbContext.CreateDataSource(db.ConnectionString);
        await using var ctx = new ToloDbContext(ToloDbContext.Options(ds));
        var dir = new EfAccountDirectory(ctx);

        var suspended = await seed.UserAsync(status: "suspended");
        Assert.Null(await dir.LoadAsync(suspended));
        Assert.Null(await dir.LoadAsync(Guid.NewGuid()));
        Assert.Equal(HttpStatusCode.Unauthorized, (await api.ClientFor(suspended).GetAsync("/api/customer/merchants")).StatusCode);
    }

    [LocalDbFact]
    public async Task Tolo_phone_links_work_through_the_real_migration_functions()
    {
        var (seed, api) = await SetupAsync();
        using var _ = api;
        var db = await TestDatabase.GetAsync();
        await using var ds = ToloDbContext.CreateDataSource(db.ConnectionString);
        await using var ctx = new ToloDbContext(ToloDbContext.Options(ds));
        var store = new EfPhoneLinkStore(ctx);
        var svc = new PhoneLinkService(store);

        var customer = await seed.UserAsync();
        var other = await seed.UserAsync();
        var staff = await seed.UserAsync("tolo_ops");
        var admin = await seed.UserAsync(adminTier: "admin");
        var phone = "+2519" + Random.Shared.Next(10_000_000, 99_999_999);

        Assert.Equal(PhoneMatch.NoLink, (await svc.MatchAsync(phone)).Match);
        await svc.LinkNewAccountAsync(customer, phone);
        var m = await svc.MatchAsync(phone);
        Assert.Equal((PhoneMatch.Linked, customer), (m.Match, m.UserId!.Value));
        await Assert.ThrowsAsync<PhoneAlreadyLinkedException>(() => svc.LinkNewAccountAsync(other, phone));

        var staffPhone = "+2519" + Random.Shared.Next(10_000_000, 99_999_999);
        var adminPhone = "+2517" + Random.Shared.Next(10_000_000, 99_999_999);
        await store.LinkAsync(staff, staffPhone);
        await store.LinkAsync(admin, adminPhone);
        Assert.Equal(PhoneMatch.Blocked, (await svc.MatchAsync(staffPhone)).Match);
        Assert.Equal(PhoneMatch.Blocked, (await svc.MatchAsync(adminPhone)).Match);
    }

    [LocalDbFact]
    public async Task A_tolo_token_with_a_linked_phone_reaches_the_customer_area_end_to_end()
    {
        var (seed, api) = await SetupAsync();
        using var _ = api;
        var db = await TestDatabase.GetAsync();
        var user = await seed.UserAsync();
        var phone = "+2519" + Random.Shared.Next(10_000_000, 99_999_999);
        await using (var ds = ToloDbContext.CreateDataSource(db.ConnectionString))
        await using (var ctx = new ToloDbContext(ToloDbContext.Options(ds)))
            await new EfPhoneLinkStore(ctx).LinkAsync(user, phone);

        // A Tolo-style subject (not a uuid) with the verified phone in the token.
        var token = api.Tokens.Issue("64f0c0ffee0000000000abcd", phone);
        Assert.Equal(HttpStatusCode.OK, (await api.ClientWithToken(token).GetAsync("/api/customer/categories")).StatusCode);
        // The same Tolo token is no key to the merchant area.
        Assert.Equal(HttpStatusCode.Forbidden, (await api.ClientWithToken(token).GetAsync("/api/merchant/merchants")).StatusCode);
    }

    // ---------------------------------------------------------------- customer area: safe columns

    [LocalDbFact]
    public async Task Customers_and_anonymous_visitors_never_see_private_merchant_fields()
    {
        var (seed, api) = await SetupAsync();
        using var _ = api;
        var owner = await seed.UserAsync();
        var cat = await seed.CategoryAsync("Safe " + Guid.NewGuid());
        var merchant = await seed.MerchantAsync(owner, "Safe Shop", category: cat);
        await seed.ProductAsync(merchant, "Safe Product", category: cat);

        var customer = api.ClientFor(await seed.UserAsync());
        foreach (var client in new[] { api.CreateClient(), customer })
        {
            foreach (var path in new[] { $"/api/customer/merchants?category_id={cat}", $"/api/customer/merchants/{merchant}", $"/api/customer/products?category_id={cat}" })
            {
                var r = await client.GetAsync(path);
                Assert.Equal(HttpStatusCode.OK, r.StatusCode);
                AssertNothingPrivate(await r.Content.ReadAsStringAsync());
            }
        }

        var detail = await JsonAsync(api.CreateClient(), $"/api/customer/merchants/{merchant}");
        Assert.Equal("Safe Shop", detail.GetProperty("business_name").GetString());
        Assert.Equal("Safe Shop", detail.GetProperty("store").GetProperty("name").GetString());
        Assert.Equal(cat, detail.GetProperty("category_id").GetGuid());
    }

    [LocalDbFact]
    public async Task Only_active_non_test_merchants_are_public()
    {
        var (seed, api) = await SetupAsync();
        using var _ = api;
        var owner = await seed.UserAsync();
        var cat = await seed.CategoryAsync("Visibility " + Guid.NewGuid());
        var active = await seed.MerchantAsync(owner, "Active", category: cat);
        var hidden = new List<Guid>
        {
            await seed.MerchantAsync(owner, "Pending", status: "pending_verification", category: cat),
            await seed.MerchantAsync(owner, "Suspended", status: "suspended", category: cat),
            await seed.MerchantAsync(owner, "Closed", status: "closed", category: cat),
            await seed.MerchantAsync(owner, "Rejected", status: "rejected", category: cat),
            await seed.MerchantAsync(owner, "Test", isTest: true, category: cat),
        };

        var c = api.CreateClient();
        Assert.Equal([active], Ids(await JsonAsync(c, $"/api/customer/merchants?category_id={cat}")));
        foreach (var id in hidden) await JsonAsync(c, $"/api/customer/merchants/{id}", HttpStatusCode.NotFound);
        // A status filter from a customer cannot widen the view.
        Assert.Equal([active], Ids(await JsonAsync(c, $"/api/customer/merchants?category_id={cat}&status=suspended")));
    }

    [LocalDbFact]
    public async Task Only_published_products_of_public_merchants_are_public()
    {
        var (seed, api) = await SetupAsync();
        using var _ = api;
        var owner = await seed.UserAsync();
        var cat = await seed.CategoryAsync("Products " + Guid.NewGuid());
        var shop = await seed.MerchantAsync(owner, "Product Shop", category: cat);
        var suspendedShop = await seed.MerchantAsync(owner, "Suspended Shop", status: "suspended", category: cat);
        var testShop = await seed.MerchantAsync(owner, "Test Shop", isTest: true, category: cat);

        var live = await seed.ProductAsync(shop, "Live", category: cat);
        var hidden = new List<Guid>
        {
            await seed.ProductAsync(shop, "Draft", status: "draft", category: cat),
            await seed.ProductAsync(shop, "Paused", status: "paused", category: cat),
            await seed.ProductAsync(shop, "Archived", status: "archived", category: cat),
            await seed.ProductAsync(suspendedShop, "Of suspended", category: cat),
            await seed.ProductAsync(testShop, "Of test", category: cat),
        };

        var c = api.CreateClient();
        Assert.Equal([live], Ids(await JsonAsync(c, $"/api/customer/products?category_id={cat}")));
        foreach (var id in hidden) await JsonAsync(c, $"/api/customer/products/{id}", HttpStatusCode.NotFound);

        var detail = await JsonAsync(c, $"/api/customer/products/{live}");
        Assert.Equal(1, detail.GetProperty("variants").GetArrayLength());
        Assert.Equal("M", detail.GetProperty("variants")[0].GetProperty("attributes").GetProperty("size").GetString());
        Assert.Equal(1, detail.GetProperty("images").GetArrayLength());
        AssertNothingPrivate(detail.GetRawText());
    }

    // ---------------------------------------------------------------- pagination, filters, search

    [LocalDbFact]
    public async Task Merchant_lists_paginate_without_overlap_and_report_the_total()
    {
        var (seed, api) = await SetupAsync();
        using var _ = api;
        var owner = await seed.UserAsync();
        var cat = await seed.CategoryAsync("Paging " + Guid.NewGuid());
        var now = DateTimeOffset.UtcNow;
        for (var i = 0; i < 5; i++) await seed.MerchantAsync(owner, $"Paged {i}", category: cat, createdAt: now.AddMinutes(-i));

        var c = api.CreateClient();
        var seen = new List<Guid>();
        foreach (var (page, expected) in new[] { (1, 2), (2, 2), (3, 1), (4, 0) })
        {
            var json = await JsonAsync(c, $"/api/customer/merchants?category_id={cat}&page={page}&page_size=2");
            Assert.Equal(5, json.GetProperty("total").GetInt32());
            Assert.Equal(page, json.GetProperty("page").GetInt32());
            Assert.Equal(2, json.GetProperty("page_size").GetInt32());
            Assert.Equal(expected, json.GetProperty("items").GetArrayLength());
            seen.AddRange(Ids(json));
        }

        Assert.Equal(5, seen.Distinct().Count());
        // newest first by default
        var all = Ids(await JsonAsync(c, $"/api/customer/merchants?category_id={cat}"));
        Assert.Equal(seen, all);
    }

    [LocalDbFact]
    public async Task Page_size_is_capped_and_bad_paging_values_are_400()
    {
        var (_, api) = await SetupAsync();
        using var _a = api;
        var c = api.CreateClient();
        var capped = await JsonAsync(c, "/api/customer/merchants?page_size=100000");
        Assert.Equal(100, capped.GetProperty("page_size").GetInt32());
        var defaults = await JsonAsync(c, "/api/customer/merchants?page=0&page_size=0");
        Assert.Equal((1, 20), (defaults.GetProperty("page").GetInt32(), defaults.GetProperty("page_size").GetInt32()));

        foreach (var bad in new[] { "page=abc", "page_size=x", "category_id=not-a-guid", "status=nonsense", "min_price=-1" })
            Assert.Equal(HttpStatusCode.BadRequest, (await c.GetAsync($"/api/customer/{(bad.StartsWith("min_price", StringComparison.Ordinal) ? "products" : "merchants")}?{bad}")).StatusCode);
    }

    [LocalDbFact]
    public async Task Merchant_search_and_filters()
    {
        var (seed, api) = await SetupAsync();
        using var _ = api;
        var owner = await seed.UserAsync();
        var token = "Zq" + Guid.NewGuid().ToString("N")[..8];
        var catA = await seed.CategoryAsync("A " + token);
        var catB = await seed.CategoryAsync("B " + token);
        var a = await seed.MerchantAsync(owner, $"{token} Bakery", category: catA, city: "Addis Ababa");
        var b = await seed.MerchantAsync(owner, $"{token} 100% Pure_Foods", category: catB, city: "Adama");
        var c1 = await seed.MerchantAsync(owner, $"{token} Zebra Tools", category: catB, city: "Adama");

        var c = api.CreateClient();
        Assert.Equivalent(new[] { a, b, c1 }, Ids(await JsonAsync(c, $"/api/customer/merchants?q={token.ToLowerInvariant()}")));
        Assert.Equal([a], Ids(await JsonAsync(c, $"/api/customer/merchants?q={token}%20bakery")));
        Assert.Equivalent(new[] { b, c1 }, Ids(await JsonAsync(c, $"/api/customer/merchants?q={token}&city=adama")));
        Assert.Equal([b], Ids(await JsonAsync(c, $"/api/customer/merchants?q={token}%20100&category_id={catB}&city=ADAMA")));
        // % and _ typed by the caller match themselves, not "anything"
        Assert.Equal([b], Ids(await JsonAsync(c, "/api/customer/merchants?q=" + Uri.EscapeDataString("100% Pure_"))));
        Assert.Empty(Ids(await JsonAsync(c, "/api/customer/merchants?q=" + Uri.EscapeDataString($"{token} 1%0"))));
        // sort by name
        Assert.Equal([b, a, c1], Ids(await JsonAsync(c, $"/api/customer/merchants?q={token}&sort=name"))); // "100%..." < "Bakery" < "Zebra"
    }

    [LocalDbFact]
    public async Task Product_search_filters_and_sorts()
    {
        var (seed, api) = await SetupAsync();
        using var _ = api;
        var owner = await seed.UserAsync();
        var cat = await seed.CategoryAsync("Filters " + Guid.NewGuid());
        var shopA = await seed.MerchantAsync(owner, "Filter Shop A", category: cat);
        var shopB = await seed.MerchantAsync(owner, "Filter Shop B", category: cat);
        var cheap = await seed.ProductAsync(shopA, "Alpha Shoe", price: 1000, category: cat);
        var discounted = await seed.ProductAsync(shopA, "Beta Shoe", price: 3000, discount: 1500, category: cat, featured: true);
        var pricey = await seed.ProductAsync(shopB, "Gamma Hat", price: 5000, category: cat, description: "warm WOOL cap");

        var c = api.CreateClient();
        string Url(string extra) => $"/api/customer/products?category_id={cat}&{extra}";

        Assert.Equivalent(new[] { cheap, discounted }, Ids(await JsonAsync(c, Url($"merchant_id={shopA}"))));
        Assert.Equal([pricey], Ids(await JsonAsync(c, Url($"merchant_id={shopB}"))));
        Assert.Equivalent(new[] { cheap, discounted }, Ids(await JsonAsync(c, Url("q=shoe"))));
        Assert.Equal([pricey], Ids(await JsonAsync(c, Url("q=wool"))));
        Assert.Equal([discounted], Ids(await JsonAsync(c, Url("featured=true"))));
        // the discount, not the base price, is what the price filters and sorts use
        Assert.Equal([discounted], Ids(await JsonAsync(c, Url("min_price=1200&max_price=2000"))));
        Assert.Equal([cheap, discounted, pricey], Ids(await JsonAsync(c, Url("sort=price_asc"))));
        Assert.Equal([pricey, discounted, cheap], Ids(await JsonAsync(c, Url("sort=price_desc"))));
        Assert.Equal([cheap, discounted, pricey], Ids(await JsonAsync(c, Url("sort=name"))));
    }

    [LocalDbFact]
    public async Task Categories_list_hides_inactive_ones_from_customers()
    {
        var (seed, api) = await SetupAsync();
        using var _ = api;
        var active = await seed.CategoryAsync("Shown " + Guid.NewGuid());
        var inactive = await seed.CategoryAsync("Hidden " + Guid.NewGuid(), active: false);

        var ids = (await JsonAsync(api.CreateClient(), "/api/customer/categories")).EnumerateArray().Select(x => x.GetProperty("id").GetGuid()).ToArray();
        Assert.Contains(active, ids);
        Assert.DoesNotContain(inactive, ids);
    }

    // ---------------------------------------------------------------- merchant area

    [LocalDbFact]
    public async Task A_merchant_team_sees_its_own_data_including_private_fields_and_nobody_elses()
    {
        var (seed, api) = await SetupAsync();
        using var _ = api;
        var ownerA = await seed.UserAsync();
        var ownerB = await seed.UserAsync();
        var workerA = await seed.UserAsync();
        var a = await seed.MerchantAsync(ownerA, "Team A", status: "suspended");
        var b = await seed.MerchantAsync(ownerB, "Team B");
        await seed.StaffAsync(a, workerA);
        var pa = await seed.ProductAsync(a, "A draft", status: "draft");
        var pb = await seed.ProductAsync(b, "B product");

        foreach (var member in new[] { ownerA, workerA })
        {
            var c = api.ClientFor(member);
            // own list: includes a suspended merchant (no public filter), and only own
            Assert.Contains(a, Ids(await JsonAsync(c, "/api/merchant/merchants")));
            Assert.DoesNotContain(b, Ids(await JsonAsync(c, "/api/merchant/merchants")));

            var detail = await JsonAsync(c, $"/api/merchant/merchants/{a}");
            Assert.Equal(DbSeed.SecretPhone, detail.GetProperty("contact").GetProperty("phone").GetString());
            Assert.Equal(DbSeed.SecretRegistration, detail.GetProperty("contact").GetProperty("business_registration_number").GetString());
            Assert.Equal("suspended", detail.GetProperty("merchant").GetProperty("status").GetString());

            // another merchant: not found, not forbidden, so its existence is not revealed
            await JsonAsync(c, $"/api/merchant/merchants/{b}", HttpStatusCode.NotFound);
            await JsonAsync(c, $"/api/merchant/merchants/{Guid.NewGuid()}", HttpStatusCode.NotFound);


            // products: own drafts are visible with the internal note; the other merchant's product is neither listed nor readable
            Assert.Contains(pa, ProductIds(await JsonAsync(c, "/api/merchant/products")));
            Assert.DoesNotContain(pb, ProductIds(await JsonAsync(c, "/api/merchant/products")));
            Assert.Empty(ProductIds(await JsonAsync(c, $"/api/merchant/products?merchant_id={b}"))); // asking for another merchant's matches nothing
            var product = await JsonAsync(c, $"/api/merchant/products/{pa}");
            Assert.Equal("internal note", product.GetProperty("rejection_reason").GetString());
            Assert.Equal("draft", product.GetProperty("summary").GetProperty("status").GetString());
            await JsonAsync(c, $"/api/merchant/products/{pb}", HttpStatusCode.NotFound);
        }
    }

    [LocalDbFact]
    public async Task A_merchant_only_ever_sees_its_own_in_a_mixed_database()
    {
        var (seed, api) = await SetupAsync();
        using var _ = api;
        var owner = await seed.UserAsync();
        var other = await seed.UserAsync();
        var mine = await seed.MerchantAsync(owner, "Mine");
        for (var i = 0; i < 3; i++) await seed.MerchantAsync(other, $"Theirs {i}");

        var c = api.ClientFor(owner);
        Assert.Equal([mine], Ids(await JsonAsync(c, "/api/merchant/merchants?page_size=100")));
        Assert.Equal(1, (await JsonAsync(c, "/api/merchant/merchants")).GetProperty("total").GetInt32());
    }

    // ---------------------------------------------------------------- admin area

    [LocalDbFact]
    public async Task Staff_with_the_merchants_page_see_every_merchant_with_contact_details_and_staff_without_it_do_not()
    {
        var (seed, api) = await SetupAsync();
        using var _ = api;
        var owner = await seed.UserAsync();
        var cat = await seed.CategoryAsync("Admin " + Guid.NewGuid());
        var active = await seed.MerchantAsync(owner, "Admin Active", category: cat);
        var pending = await seed.MerchantAsync(owner, "Admin Pending", status: "pending_verification", category: cat);
        var test = await seed.MerchantAsync(owner, "Admin Test", isTest: true, category: cat);

        var allowed = new[]
        {
            api.ClientFor(await seed.UserAsync("tolo_ops", pages: ["merchants"])),
            api.ClientFor(await seed.UserAsync(adminTier: "admin")),
            api.ClientFor(await seed.SuperAdminAsync()),
        };
        foreach (var c in allowed)
        {
            Assert.Equivalent(new[] { active, pending, test }, Ids(await JsonAsync(c, $"/api/admin/merchants?category_id={cat}")));
            Assert.Equal([pending], Ids(await JsonAsync(c, $"/api/admin/merchants?category_id={cat}&status=pending_verification")));
            var detail = await JsonAsync(c, $"/api/admin/merchants/{pending}");
            Assert.Equal(DbSeed.SecretEmail, detail.GetProperty("contact").GetProperty("email").GetString());
            Assert.Equal(DbSeed.SecretOwner, detail.GetProperty("contact").GetProperty("owner_full_name").GetString());
            await JsonAsync(c, $"/api/admin/merchants/{Guid.NewGuid()}", HttpStatusCode.NotFound);
        }

        var other = api.ClientFor(await seed.UserAsync("tolo_ops", pages: ["orders", "products"]));
        await JsonAsync(other, "/api/admin/merchants", HttpStatusCode.Forbidden);
        await JsonAsync(other, $"/api/admin/merchants/{active}", HttpStatusCode.Forbidden);
    }

    [LocalDbFact]
    public async Task Products_and_categories_in_the_admin_area_need_the_products_page()
    {
        var (seed, api) = await SetupAsync();
        using var _ = api;
        var owner = await seed.UserAsync();
        var cat = await seed.CategoryAsync("AdminCat " + Guid.NewGuid());
        var inactive = await seed.CategoryAsync("AdminInactive " + Guid.NewGuid(), active: false);
        var shop = await seed.MerchantAsync(owner, "Admin Products Shop", category: cat);
        var draft = await seed.ProductAsync(shop, "Admin draft", status: "draft", category: cat);
        var live = await seed.ProductAsync(shop, "Admin live", category: cat);

        var staff = api.ClientFor(await seed.UserAsync("tolo_ops", pages: ["products"]));
        Assert.Equivalent(new[] { draft, live }, ProductIds(await JsonAsync(staff, $"/api/admin/products?category_id={cat}")));
        Assert.Equal([draft], ProductIds(await JsonAsync(staff, $"/api/admin/products?category_id={cat}&status=draft")));
        Assert.Equal("internal note", (await JsonAsync(staff, $"/api/admin/products/{draft}")).GetProperty("rejection_reason").GetString());
        Assert.Contains(inactive, (await JsonAsync(staff, "/api/admin/categories")).EnumerateArray().Select(x => x.GetProperty("id").GetGuid()));

        var merchantsOnly = api.ClientFor(await seed.UserAsync("tolo_ops", pages: ["merchants"]));
        await JsonAsync(merchantsOnly, "/api/admin/products", HttpStatusCode.Forbidden);
        await JsonAsync(merchantsOnly, "/api/admin/categories", HttpStatusCode.Forbidden);
    }

    private static Guid[] ProductIds(JsonElement page) =>
        page.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("product").GetProperty("id").GetGuid()).ToArray();

    // ---------------------------------------------------------------- the database is only ever read

    [LocalDbFact]
    public async Task The_readers_leave_every_table_unchanged()
    {
        var (seed, api) = await SetupAsync();
        using var _ = api;
        var db = await TestDatabase.GetAsync();
        var owner = await seed.UserAsync();
        var shop = await seed.MerchantAsync(owner, "Readonly Shop");
        await seed.ProductAsync(shop, "Readonly Product");

        async Task<string> FingerprintAsync()
        {
            await using var conn = new Npgsql.NpgsqlConnection(db.ConnectionString);
            await conn.OpenAsync();
            await using var cmd = new Npgsql.NpgsqlCommand(
                "select (select md5(string_agg(m::text, '' order by id)) from merchants m) || (select md5(string_agg(p::text, '' order by id)) from products p) || (select count(*)::text from profiles)", conn);
            return (string)(await cmd.ExecuteScalarAsync())!;
        }

        var before = await FingerprintAsync();
        var c = api.CreateClient();
        await c.GetAsync("/api/customer/merchants");
        await c.GetAsync("/api/customer/products");
        await api.ClientFor(owner).GetAsync("/api/merchant/merchants");
        Assert.Equal(before, await FingerprintAsync());
    }

    [Fact]
    public void The_context_defines_no_migrations_so_the_schema_stays_owned_by_supabase()
    {
        using var ds = Npgsql.NpgsqlDataSource.Create("Host=localhost;Database=none");
        using var ctx = new ToloDbContext(ToloDbContext.Options(ds));
        Assert.Empty(ctx.Database.GetMigrations());
        Assert.False(Directory.Exists(LocalDb.RepoFile("backend", "src", "Tolo.Infrastructure", "Migrations")));
    }

    [Theory]
    [InlineData("Host=db.abcdefghij.supabase.co;Database=postgres")]
    [InlineData("postgresql://u:p@aws-0-eu.pooler.supabase.com:6543/postgres")]
    public void Non_local_hosts_are_refused(string url) =>
        Assert.Throws<InvalidOperationException>(() => LocalDb.Validate(url));

    [Theory]
    [InlineData("Host=localhost;Database=postgres")]
    [InlineData("postgres://postgres@127.0.0.1:5432/postgres")]
    [InlineData("postgres://postgres:postgres@db:5432/postgres")]
    public void Local_hosts_are_allowed(string url) => Assert.NotEmpty(LocalDb.Validate(url));
}
