using System.Text.Json;
using System.Text.Json.Serialization;
using Tolo.Domain.Common;
using Tolo.Domain.Identity;

namespace Tolo.Domain.Catalog;

/// <summary>The Postgres enum product_status (0004).</summary>
public enum ProductStatus
{
    Draft,
    Submitted,
    Approved,
    Published,
    Paused,
    Archived,
}

public sealed record Category
{
    [JsonPropertyName("id")] public required Guid Id { get; init; }
    [JsonPropertyName("parent_id")] public Guid? ParentId { get; init; }
    [JsonPropertyName("name")] public required string Name { get; init; }
    [JsonPropertyName("name_am")] public string? NameAm { get; init; }
    [JsonPropertyName("slug")] public required string Slug { get; init; }
    [JsonPropertyName("image_url")] public string? ImageUrl { get; init; }
    [JsonPropertyName("icon")] public string Icon { get; init; } = "tag";
    [JsonPropertyName("color")] public string Color { get; init; } = "navy";
    [JsonPropertyName("sort_order")] public int SortOrder { get; init; }
    [JsonPropertyName("is_active")] public bool IsActive { get; init; }
}

public sealed record ProductImage(
    [property: JsonPropertyName("url")] string Url,
    [property: JsonPropertyName("sort_order")] int SortOrder,
    [property: JsonPropertyName("is_primary")] bool IsPrimary);

public sealed record ProductVariant(
    [property: JsonPropertyName("id")] Guid Id,
    [property: JsonPropertyName("sku")] string? Sku,
    [property: JsonPropertyName("attributes")] JsonElement Attributes,
    [property: JsonPropertyName("price")] decimal Price,
    [property: JsonPropertyName("discount_price")] decimal? DiscountPrice,
    [property: JsonPropertyName("is_default")] bool IsDefault);

/// <summary>A product as a listing row: enough for a card.</summary>
public sealed record ProductSummary
{
    [JsonPropertyName("id")] public required Guid Id { get; init; }
    [JsonPropertyName("merchant_id")] public Guid MerchantId { get; init; }
    [JsonPropertyName("category_id")] public Guid? CategoryId { get; init; }
    [JsonPropertyName("name")] public required string Name { get; init; }
    [JsonPropertyName("slug")] public required string Slug { get; init; }
    [JsonPropertyName("base_price")] public decimal BasePrice { get; init; }
    [JsonPropertyName("discount_price")] public decimal? DiscountPrice { get; init; }
    [JsonPropertyName("is_featured")] public bool IsFeatured { get; init; }
    [JsonPropertyName("image_url")] public string? ImageUrl { get; init; }
}

public sealed record PublicProduct
{
    [JsonPropertyName("product")] public required ProductSummary Product { get; init; }
    [JsonPropertyName("description")] public string? Description { get; init; }
    [JsonPropertyName("images")] public IReadOnlyList<ProductImage> Images { get; init; } = [];
    [JsonPropertyName("variants")] public IReadOnlyList<ProductVariant> Variants { get; init; } = [];
}

/// <summary>Listing row for a merchant's own team and for admins: adds the workflow status.</summary>
public sealed record ManagedProductSummary
{
    [JsonPropertyName("product")] public required ProductSummary Product { get; init; }
    [JsonPropertyName("status")] public ProductStatus Status { get; init; }
    [JsonPropertyName("updated_at")] public DateTimeOffset UpdatedAt { get; init; }
}

public sealed record ManagedProduct
{
    [JsonPropertyName("summary")] public required ManagedProductSummary Summary { get; init; }
    [JsonPropertyName("description")] public string? Description { get; init; }
    [JsonPropertyName("rejection_reason")] public string? RejectionReason { get; init; }
    [JsonPropertyName("images")] public IReadOnlyList<ProductImage> Images { get; init; } = [];
    [JsonPropertyName("variants")] public IReadOnlyList<ProductVariant> Variants { get; init; } = [];
}

public sealed record ProductQuery(
    string? Q = null,
    Guid? MerchantId = null,
    Guid? CategoryId = null,
    decimal? MinPrice = null,
    decimal? MaxPrice = null,
    bool? Featured = null,
    ProductStatus? Status = null,
    string? Sort = null);

public interface ICatalogReader
{
    Task<IReadOnlyList<Category>> ListCategoriesAsync(bool includeInactive, CancellationToken ct = default);

    /// <summary>Published products of active, non-test merchants only.</summary>
    Task<Page<ProductSummary>> ListPublicProductsAsync(ProductQuery query, PageRequest page, CancellationToken ct = default);

    Task<PublicProduct?> GetPublicProductAsync(Guid id, CancellationToken ct = default);

    /// <summary>Every status. <paramref name="onlyMerchantIds"/> limits the result to those merchants (null = no limit).</summary>
    Task<Page<ManagedProductSummary>> ListManagedProductsAsync(ProductQuery query, PageRequest page, IReadOnlyCollection<Guid>? onlyMerchantIds, CancellationToken ct = default);

    Task<ManagedProduct?> GetManagedProductAsync(Guid id, CancellationToken ct = default);
}

public sealed class CatalogModule(ICatalogReader reader)
{
    public const string AdminPage = "products";

    public Task<IReadOnlyList<Category>> CategoriesForCustomerAsync(CancellationToken ct = default) => reader.ListCategoriesAsync(false, ct);

    public Task<IReadOnlyList<Category>> CategoriesForAdminAsync(ToloPrincipal who, CancellationToken ct = default)
    {
        RequireProductsPage(who);
        return reader.ListCategoriesAsync(true, ct);
    }

    public Task<Page<ProductSummary>> ListForCustomerAsync(ProductQuery q, PageRequest p, CancellationToken ct = default) =>
        reader.ListPublicProductsAsync(q with { Status = null }, p, ct);

    public Task<PublicProduct?> GetForCustomerAsync(Guid id, CancellationToken ct = default) => reader.GetPublicProductAsync(id, ct);

    public Task<Page<ManagedProductSummary>> ListForMerchantAsync(ToloPrincipal who, ProductQuery q, PageRequest p, CancellationToken ct = default)
    {
        // Asking for another merchant's products does not fail loudly, it matches nothing: the id set is always the caller's own.
        Guid[] mine = q.MerchantId is { } m ? who.MerchantIds.Where(id => id == m).ToArray() : who.MerchantIds.ToArray();
        return reader.ListManagedProductsAsync(q with { MerchantId = null }, p, mine, ct);
    }

    /// <summary>Null (a 404) when the product is missing or belongs to a merchant the caller is not on.</summary>
    public async Task<ManagedProduct?> GetForMerchantAsync(ToloPrincipal who, Guid id, CancellationToken ct = default)
    {
        var product = await reader.GetManagedProductAsync(id, ct);
        return product is not null && who.IsMemberOf(product.Summary.Product.MerchantId) ? product : null;
    }

    public Task<Page<ManagedProductSummary>> ListForAdminAsync(ToloPrincipal who, ProductQuery q, PageRequest p, CancellationToken ct = default)
    {
        RequireProductsPage(who);
        return reader.ListManagedProductsAsync(q, p, null, ct);
    }

    public Task<ManagedProduct?> GetForAdminAsync(ToloPrincipal who, Guid id, CancellationToken ct = default)
    {
        RequireProductsPage(who);
        return reader.GetManagedProductAsync(id, ct);
    }

    private static void RequireProductsPage(ToloPrincipal who)
    {
        if (!who.HasAdminPage(AdminPage)) throw new ForbiddenException("The Products page is required.");
    }
}
