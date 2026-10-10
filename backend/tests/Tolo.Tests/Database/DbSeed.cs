using System.Text.Json;
using Npgsql;

namespace Tolo.Tests.Database;

/// <summary>
/// Inserts fixtures straight into the throwaway test database with SQL. session_replication_role = replica switches triggers and foreign
/// keys off for the seeding connection only, so fixtures (a published product, a staff role) do not have to go through the app's rules.
/// </summary>
public sealed class DbSeed(string connectionString)
{
    public const string SecretPhone = "+251911000111";
    public const string SecretEmail = "secret-owner@example.test";
    public const string SecretOwner = "Secret Owner Name";
    public const string SecretRegistration = "REG-SECRET-4242";

    private async Task ExecAsync(string sql, params (string Name, object? Value)[] args)
    {
        await using var conn = new NpgsqlConnection(connectionString);
        await conn.OpenAsync();
        await using (var init = new NpgsqlCommand("set session_replication_role = replica", conn)) await init.ExecuteNonQueryAsync();
        await using var cmd = new NpgsqlCommand(sql, conn);
        foreach (var (name, value) in args) cmd.Parameters.AddWithValue(name, value ?? DBNull.Value);
        await cmd.ExecuteNonQueryAsync();
    }

    public async Task<Guid> UserAsync(string role = "customer", string? adminTier = null, string[]? pages = null, string status = "active", string? email = null)
    {
        var id = Guid.NewGuid();
        await ExecAsync(
            "insert into auth.users (id, email) values (@id, @email);" +
            "insert into profiles (id, role, admin_tier, permissions, account_status) values (@id, @role::user_role_platform, @tier, @perms::jsonb, @status::account_status)",
            ("id", id), ("email", email ?? $"{id}@test.local"), ("role", role), ("tier", adminTier), ("perms", JsonSerializer.Serialize(pages ?? [])), ("status", status));
        return id;
    }

    /// <summary>The schema allows exactly one super admin (idx_profiles_one_super_admin), so this creates it once and reuses it.</summary>
    public async Task<Guid> SuperAdminAsync()
    {
        await using var conn = new NpgsqlConnection(connectionString);
        await conn.OpenAsync();
        await using var cmd = new NpgsqlCommand("select id from profiles where admin_tier = 'super_admin' limit 1", conn);
        if (await cmd.ExecuteScalarAsync() is Guid existing) return existing;
        return await UserAsync("tolo_admin", adminTier: "super_admin");
    }

    public async Task<Guid> CategoryAsync(string name, bool active = true, int sortOrder = 0)
    {
        var id = Guid.NewGuid();
        await ExecAsync(
            "insert into categories (id, name, slug, is_active, sort_order) values (@id, @name, @slug, @active, @sort)",
            ("id", id), ("name", name), ("slug", id.ToString()), ("active", active), ("sort", sortOrder));
        return id;
    }

    /// <summary>A merchant with a store, and SECRET contact details the API must never show to anyone but its team and the right staff.</summary>
    public async Task<Guid> MerchantAsync(Guid owner, string name, string status = "active", bool isTest = false, Guid? category = null, string? city = "Addis Ababa", DateTimeOffset? createdAt = null)
    {
        var id = Guid.NewGuid();
        await ExecAsync(
            """
            insert into merchants (id, owner_id, business_name, status, is_test, category_id, city, sub_city, location, phone, email,
                                   owner_full_name, owner_phone, owner_email, business_registration_number, created_at)
            values (@id, @owner, @name, @status::merchant_status, @test, @cat, @city, 'Bole', 'Bole Rd', @phone, @email, @oname, @phone, @email, @reg, @created);
            insert into stores (id, merchant_id, name, slug, status) values (gen_random_uuid(), @id, @name, @id::text, 'active');
            """,
            ("id", id), ("owner", owner), ("name", name), ("status", status), ("test", isTest), ("cat", category), ("city", city),
            ("phone", SecretPhone), ("email", SecretEmail), ("oname", SecretOwner), ("reg", SecretRegistration), ("created", createdAt ?? DateTimeOffset.UtcNow));
        return id;
    }

    public async Task StaffAsync(Guid merchant, Guid user, string role = "order_manager") =>
        await ExecAsync("insert into merchant_staff (merchant_id, user_id, role) values (@m, @u, @r::merchant_staff_role)", ("m", merchant), ("u", user), ("r", role));

    public async Task<Guid> ProductAsync(Guid merchant, string name, decimal price = 1200, decimal? discount = null, string status = "published", Guid? category = null, bool featured = false, string? description = null)
    {
        var id = Guid.NewGuid();
        await ExecAsync(
            """
            insert into products (id, merchant_id, store_id, category_id, name, slug, description, base_price, discount_price, status, is_featured, rejection_reason)
            values (@id, @m, (select id from stores where merchant_id = @m), @cat, @name, @id::text, @desc, @price, @disc, @status::product_status, @feat, 'internal note');
            insert into product_variants (product_id, sku, attributes, price, is_default) values (@id, 'SKU-' || @id::text, '{"size":"M"}'::jsonb, @price, true);
            insert into product_images (product_id, url, sort_order, is_primary) values (@id, 'https://img.test/' || @id::text || '.jpg', 0, true);
            """,
            ("id", id), ("m", merchant), ("cat", category), ("name", name), ("desc", description), ("price", price), ("disc", discount), ("status", status), ("feat", featured));
        return id;
    }
}
