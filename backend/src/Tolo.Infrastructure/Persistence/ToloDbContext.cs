using Microsoft.EntityFrameworkCore;

namespace Tolo.Infrastructure.Persistence;

/// <summary>
/// DB-first mapping onto the EXISTING schema owned by supabase/migrations. This context never creates or changes tables:
/// there are no EF migrations in this project, and nothing calls Database.Migrate or EnsureCreated. To map another table,
/// add only the columns needed, matching the migration by hand or via
/// `dotnet ef dbcontext scaffold ... --table <name>` against a LOCAL database. Never against live.
/// </summary>
public sealed class ToloDbContext(DbContextOptions<ToloDbContext> options) : DbContext(options)
{
    public DbSet<PhoneLinkRow> PhoneLinks => Set<PhoneLinkRow>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<PhoneLinkRow>(e =>
        {
            e.ToTable("tolo_phone_links");
            e.HasKey(x => x.UserId);
            e.Property(x => x.UserId).HasColumnName("user_id");
            e.Property(x => x.Phone).HasColumnName("phone");
            e.Property(x => x.LinkedAt).HasColumnName("linked_at").ValueGeneratedOnAdd();
            e.Property(x => x.LastLoginAt).HasColumnName("last_login_at").ValueGeneratedOnAdd();
            e.HasIndex(x => x.Phone).IsUnique();
        });
    }
}

public sealed class PhoneLinkRow
{
    public Guid UserId { get; set; }
    public string Phone { get; set; } = "";
    public DateTimeOffset LinkedAt { get; set; }
    public DateTimeOffset LastLoginAt { get; set; }
}
