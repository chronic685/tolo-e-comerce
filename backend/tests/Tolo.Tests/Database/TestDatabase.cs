using Npgsql;
using Tolo.Api.Configuration;

namespace Tolo.Tests.Database;

/// <summary>
/// Runs only when TOLO_TEST_DATABASE_URL points at a LOCAL Postgres (localhost / 127.0.0.1 / the compose "db" host). It refuses anything
/// else, so a mistyped URL can never reach the live project.
/// </summary>
public sealed class LocalDbFactAttribute : FactAttribute
{
    public LocalDbFactAttribute()
    {
        if (LocalDb.Url is null) Skip = "TOLO_TEST_DATABASE_URL is not set (start backend/docker-compose.yml and set it to run the database tests).";
    }
}

public sealed class LocalDbTheoryAttribute : TheoryAttribute
{
    public LocalDbTheoryAttribute()
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
            return Validate(raw);
        }
    }

    /// <summary>Throws unless the connection string's host is local.</summary>
    public static string Validate(string raw)
    {
        var cs = ConnectionStrings.ToNpgsql(raw);
        var host = new NpgsqlConnectionStringBuilder(cs).Host ?? "";
        if (!LocalHosts.Contains(host, StringComparer.OrdinalIgnoreCase))
            throw new InvalidOperationException($"Refusing to run database tests against non-local host '{host}'.");
        return cs;
    }

    public static string RepoFile(params string[] parts)
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !Directory.Exists(Path.Combine(dir.FullName, "supabase", "migrations"))) dir = dir.Parent;
        return Path.Combine([dir?.FullName ?? throw new InvalidOperationException("repo root not found"), .. parts]);
    }
}

/// <summary>
/// One throwaway database per test run: the Supabase stubs, then EVERY file in supabase/migrations in order, exactly as written.
/// Created next to the database named in TOLO_TEST_DATABASE_URL and dropped at the end of the run.
/// </summary>
public sealed class TestDatabase
{
    private static readonly Lazy<Task<TestDatabase>> Shared = new(CreateAsync);

    private readonly string _adminConnectionString;
    private readonly string _name;

    private TestDatabase(string adminConnectionString, string name, string connectionString)
    {
        _adminConnectionString = adminConnectionString;
        _name = name;
        ConnectionString = connectionString;
    }

    public string ConnectionString { get; }

    public static Task<TestDatabase> GetAsync() => Shared.Value;

    private static async Task<TestDatabase> CreateAsync()
    {
        var admin = LocalDb.Url ?? throw new InvalidOperationException("TOLO_TEST_DATABASE_URL is not set.");
        var name = "tolo_test_" + Guid.NewGuid().ToString("N")[..12];
        await using (var conn = new NpgsqlConnection(admin))
        {
            await conn.OpenAsync();
            await using var cmd = new NpgsqlCommand($"create database {name}", conn);
            await cmd.ExecuteNonQueryAsync();
        }

        var cs = new NpgsqlConnectionStringBuilder(admin) { Database = name, Pooling = false }.ConnectionString;
        await using (var conn = new NpgsqlConnection(cs))
        {
            await conn.OpenAsync();
            await RunAsync(conn, await File.ReadAllTextAsync(Path.Combine(AppContext.BaseDirectory, "Database", "supabase_stubs.sql")), "supabase_stubs.sql");
            var files = Directory.GetFiles(LocalDb.RepoFile("supabase", "migrations"), "*.sql").OrderBy(f => f, StringComparer.Ordinal);
            foreach (var file in files)
            {
                // pg_cron is stubbed in supabase_stubs.sql; every other extension in the migrations ships with Postgres.
                var sql = (await File.ReadAllTextAsync(file)).Replace("create extension if not exists pg_cron;", "", StringComparison.Ordinal);
                await RunAsync(conn, sql, Path.GetFileName(file));
            }
        }

        var created = new TestDatabase(admin, name, new NpgsqlConnectionStringBuilder(admin) { Database = name }.ConnectionString);
        AppDomain.CurrentDomain.ProcessExit += (_, _) => created.Drop();
        return created;
    }

    private static async Task RunAsync(NpgsqlConnection conn, string sql, string label)
    {
        try
        {
            await using var cmd = new NpgsqlCommand(sql, conn);
            await cmd.ExecuteNonQueryAsync();
        }
        catch (PostgresException ex)
        {
            throw new InvalidOperationException($"{label}: {ex.MessageText} (SQLSTATE {ex.SqlState}, line {ex.Line}, near position {ex.Position}) {ex.Where}", ex);
        }
    }

    /// <summary>Drops the throwaway database. Runs when the test process exits; the database is shared by every test in the run.</summary>
    public void Drop()
    {
        try
        {
            NpgsqlConnection.ClearAllPools();
            using var conn = new NpgsqlConnection(_adminConnectionString);
            conn.Open();
            using var cmd = new NpgsqlCommand($"drop database if exists {_name} with (force)", conn);
            cmd.ExecuteNonQuery();
        }
        catch (NpgsqlException)
        {
            // Best effort: a leftover tolo_test_* database is harmless and only ever exists on a local server.
        }
    }
}
