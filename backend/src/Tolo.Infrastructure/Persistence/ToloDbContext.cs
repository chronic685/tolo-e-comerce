using System.Text;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Tolo.Domain.Catalog;
using Tolo.Domain.Merchants;

namespace Tolo.Infrastructure.Persistence;

/// <summary>
/// DB-first mapping onto the EXISTING schema owned by supabase/migrations. This context never creates or changes anything: there are
/// no EF migrations in this project and nothing calls Database.Migrate or EnsureCreated. Only the columns this backend reads are mapped.
/// Private merchant columns (phone, email, owner, registration number) are deliberately NOT mapped here; they are read by one explicit
/// query in <see cref="EfMerchantReader"/>, so a public query cannot select them by accident.
/// </summary>
public sealed class ToloDbContext(DbContextOptions<ToloDbContext> options) : DbContext(options)
{
    public DbSet<MerchantRow> Merchants => Set<MerchantRow>();

    public DbSet<StoreRow> Stores => Set<StoreRow>();

    public DbSet<CategoryRow> Categories => Set<CategoryRow>();

    public DbSet<ProductRow> Products => Set<ProductRow>();

    public DbSet<VariantRow> Variants => Set<VariantRow>();

    public DbSet<ImageRow> Images => Set<ImageRow>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.HasPostgresEnum<MerchantStatus>("merchant_status");
        modelBuilder.HasPostgresEnum<ProductStatus>("product_status");

        modelBuilder.Entity<MerchantRow>().ToTable("merchants");
        modelBuilder.Entity<StoreRow>().ToTable("stores");
        modelBuilder.Entity<CategoryRow>().ToTable("categories");
        modelBuilder.Entity<ProductRow>().ToTable("products");
        modelBuilder.Entity<VariantRow>().ToTable("product_variants");
        modelBuilder.Entity<ImageRow>().ToTable("product_images");
        modelBuilder.Entity<VariantRow>().Property(v => v.Attributes).HasColumnType("jsonb");

        // Columns are snake_case in the database and PascalCase here.
        foreach (var entity in modelBuilder.Model.GetEntityTypes())
            foreach (var property in entity.GetProperties())
                property.SetColumnName(ToSnakeCase(property.Name));
    }

    internal static string ToSnakeCase(string name)
    {
        var sb = new StringBuilder();
        for (var i = 0; i < name.Length; i++)
        {
            if (char.IsUpper(name[i]) && i > 0) sb.Append('_');
            sb.Append(char.ToLowerInvariant(name[i]));
        }

        return sb.ToString();
    }

    /// <summary>The data source with the Postgres enums mapped. Use it for every connection to the marketplace database.</summary>
    public static NpgsqlDataSource CreateDataSource(string connectionString)
    {
        var builder = new NpgsqlDataSourceBuilder(connectionString);
        builder.MapEnum<MerchantStatus>("merchant_status");
        builder.MapEnum<ProductStatus>("product_status");
        return builder.Build();
    }

    public static void Configure(DbContextOptionsBuilder options, NpgsqlDataSource dataSource) =>
        options.UseNpgsql(dataSource, o =>
        {
            o.MapEnum<MerchantStatus>("merchant_status");
            o.MapEnum<ProductStatus>("product_status");
        });

    public static DbContextOptions<ToloDbContext> Options(NpgsqlDataSource dataSource)
    {
        var builder = new DbContextOptionsBuilder<ToloDbContext>();
        Configure(builder, dataSource);
        return builder.Options;
    }
}

public sealed class MerchantRow
{
    public Guid Id { get; set; }
    public Guid OwnerId { get; set; }
    public string BusinessName { get; set; } = "";
    public Guid? CategoryId { get; set; }
    public MerchantStatus Status { get; set; }
    public bool IsTest { get; set; }
    public string? Location { get; set; }
    public string? City { get; set; }
    public string? SubCity { get; set; }
    public string? Woreda { get; set; }
    public string? Landmark { get; set; }
    public decimal? Latitude { get; set; }
    public decimal? Longitude { get; set; }
    public string? RejectionReason { get; set; }
    public string? SuspensionReason { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}

public sealed class StoreRow
{
    public Guid Id { get; set; }
    public Guid MerchantId { get; set; }
    public string Name { get; set; } = "";
    public string Slug { get; set; } = "";
    public string? LogoUrl { get; set; }
    public string? BannerUrl { get; set; }
    public string? Description { get; set; }
}

public sealed class CategoryRow
{
    public Guid Id { get; set; }
    public Guid? ParentId { get; set; }
    public string Name { get; set; } = "";
    public string? NameAm { get; set; }
    public string Slug { get; set; } = "";
    public string? ImageUrl { get; set; }
    public string Icon { get; set; } = "tag";
    public string Color { get; set; } = "navy";
    public int SortOrder { get; set; }
    public bool IsActive { get; set; }
}

public sealed class ProductRow
{
    public Guid Id { get; set; }
    public Guid MerchantId { get; set; }
    public Guid? CategoryId { get; set; }
    public string Name { get; set; } = "";
    public string Slug { get; set; } = "";
    public string? Description { get; set; }
    public decimal BasePrice { get; set; }
    public decimal? DiscountPrice { get; set; }
    public ProductStatus Status { get; set; }
    public bool IsFeatured { get; set; }
    public string? RejectionReason { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}

public sealed class VariantRow
{
    public Guid Id { get; set; }
    public Guid ProductId { get; set; }
    public string? Sku { get; set; }
    public string Attributes { get; set; } = "{}";
    public decimal Price { get; set; }
    public decimal? DiscountPrice { get; set; }
    public bool IsDefault { get; set; }
}

public sealed class ImageRow
{
    public Guid Id { get; set; }
    public Guid ProductId { get; set; }
    public string Url { get; set; } = "";
    public int SortOrder { get; set; }
    public bool IsPrimary { get; set; }
}
