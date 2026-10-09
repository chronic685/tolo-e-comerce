using Microsoft.EntityFrameworkCore;
using Npgsql;
using Tolo.Domain.Abstractions;
using Tolo.Domain.Services;
using Tolo.Infrastructure.Persistence;

namespace Tolo.Tests.Database;

/// <summary>
/// Runs only when TOLO_TEST_DATABASE_URL points at a LOCAL Postgres (localhost / 127.0.0.1 / the compose "db" host), such as the
/// one in backend/docker-compose.yml. It refuses anything else, so a mistyped URL can never reach the live project.
/// The fixture builds the real schema pieces from supabase/migrations (0072 plus a stub of the profiles table) in a throwaway schema.
/// </summary>
public sealed class LocalDbFactAttribute : FactAttribute
{
    public LocalDbFactAttribute()
    {
        if (LocalDb.Url is null) Skip = "TOLO_TEST_DATABASE_URL is not set (start backend/docker-compose.yml and set it to run the database tests).";
    }
}

public static class LocalDb
{
    private static readonly string[] LocalHosts = ["localhost", "127.0.0.1", "::1", "db", "postgres"];

    public static string? Url
    {
        get
        {
            var raw = Environment.GetEnvironmentVariable("TOLO_TEST_DATABASE_URL");
            if (string.IsNullOrWhiteSpace(raw)) return null;
            var cs = Tolo.Api.Configuration.ConnectionStrings.ToNpgsql(raw);
            var host = new NpgsqlConnectionStringBuilder(cs).Host ?? "";
            if (!LocalHosts.Contains(host, StringComparer.OrdinalIgnoreCase))
                throw new InvalidOperationException($"Refusing to run database tests against non-local host '{host}'.");
            return cs;
        }
    }

    public static string RepoFile(params string[] parts)
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !Directory.Exists(Path.Combine(dir.FullName, "supabase", "migrations"))) dir = dir.Parent;
        return Path.Combine([dir?.FullName ?? throw new InvalidOperationException("repo root not found"), .. parts]);
    }
}

public sealed class LocalDbTests
{
    private static async Task<(ToloDbContext db, string schema)> FreshSchemaAsync()
    {
        var cs = LocalDb.Url!;
        await using var conn = new NpgsqlConnection(cs);
        await conn.OpenAsync();
        // The migration's functions pin search_path to public, so this resets public itself. That is safe only because LocalDb.Url
        // has already refused any non-local host. Stubs stand in for the Supabase-only pieces (roles, auth.uid()); the migration runs unmodified.
        var setup = """
            drop schema if exists public cascade;
            create schema public;
            create schema if not exists auth;
            create or replace function auth.uid() returns uuid language sql as 'select null::uuid';
            do $$ begin
              if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
              if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
              if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
            end $$;
            create type user_role as enum ('customer', 'tolo_ops');
            create table profiles (id uuid primary key, role user_role not null default 'customer', admin_tier text);
            """ + await File.ReadAllTextAsync(LocalDb.RepoFile("supabase", "migrations", "0072_tolo_phone_links.sql"));
        await using (var cmd = new NpgsqlCommand(setup, conn)) await cmd.ExecuteNonQueryAsync();

        var options = new DbContextOptionsBuilder<ToloDbContext>().UseNpgsql(cs).Options;
        return (new ToloDbContext(options), "public");
    }

    private static async Task AddProfileAsync(ToloDbContext db, Guid id, string role = "customer", string? tier = null) =>
        await db.Database.ExecuteSqlAsync($"insert into profiles (id, role, admin_tier) values ({id}, {role}::user_role, {tier})");

    [LocalDbFact]
    public async Task Link_then_find_round_trips_through_the_real_migration_functions()
    {
        var (db, _) = await FreshSchemaAsync();
        var id = Guid.NewGuid();
        await AddProfileAsync(db, id);
        var svc = new PhoneLinkService(new EfPhoneLinkStore(db));

        Assert.Equal(PhoneMatch.NoLink, (await svc.MatchAsync("0912345678")).Match);
        await svc.LinkNewAccountAsync(id, "0912345678");
        var m = await svc.MatchAsync("+251912345678");
        Assert.Equal(PhoneMatch.Linked, m.Match);
        Assert.Equal(id, m.UserId);
    }

    [LocalDbFact]
    public async Task A_phone_cannot_be_linked_twice()
    {
        var (db, _) = await FreshSchemaAsync();
        var a = Guid.NewGuid();
        var b = Guid.NewGuid();
        await AddProfileAsync(db, a);
        await AddProfileAsync(db, b);
        var store = new EfPhoneLinkStore(db);
        await store.LinkAsync(a, "+251912345678");

        await Assert.ThrowsAsync<PhoneAlreadyLinkedException>(() => store.LinkAsync(b, "+251912345678"));
    }

    [LocalDbFact]
    public async Task Staff_and_admin_accounts_are_blocked()
    {
        var (db, _) = await FreshSchemaAsync();
        var staff = Guid.NewGuid();
        var admin = Guid.NewGuid();
        await AddProfileAsync(db, staff, role: "tolo_ops");
        await AddProfileAsync(db, admin, tier: "admin");
        var store = new EfPhoneLinkStore(db);
        await store.LinkAsync(staff, "+251911111111");
        await store.LinkAsync(admin, "+251922222222");
        var svc = new PhoneLinkService(store);

        Assert.Equal(PhoneMatch.Blocked, (await svc.MatchAsync("+251911111111")).Match);
        Assert.Equal(PhoneMatch.Blocked, (await svc.MatchAsync("+251922222222")).Match);
    }

    [Fact]
    public void The_context_defines_no_migrations_so_the_schema_stays_owned_by_supabase()
    {
        var options = new DbContextOptionsBuilder<ToloDbContext>().UseNpgsql("Host=localhost").Options;
        using var db = new ToloDbContext(options);
        Assert.Empty(db.Database.GetMigrations());
        Assert.False(Directory.Exists(LocalDb.RepoFile("backend", "src", "Tolo.Infrastructure", "Migrations")));
    }

    [Theory]
    [InlineData("Host=db.abcdefghij.supabase.co;Database=postgres")]
    [InlineData("postgresql://u:p@aws-0-eu.pooler.supabase.com:6543/postgres")]
    public void Non_local_hosts_are_refused(string url)
    {
        var old = Environment.GetEnvironmentVariable("TOLO_TEST_DATABASE_URL");
        try
        {
            Environment.SetEnvironmentVariable("TOLO_TEST_DATABASE_URL", url);
            Assert.Throws<InvalidOperationException>(() => LocalDb.Url);
        }
        finally
        {
            Environment.SetEnvironmentVariable("TOLO_TEST_DATABASE_URL", old);
        }
    }
}
