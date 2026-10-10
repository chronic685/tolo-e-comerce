using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Tolo.Domain.Catalog;
using Tolo.Domain.Common;
using Tolo.Domain.Merchants;

namespace Tolo.Infrastructure.Persistence;

public sealed class EfCatalogReader(ToloDbContext db) : ICatalogReader
{
    public async Task<IReadOnlyList<Category>> ListCategoriesAsync(bool includeInactive, CancellationToken ct = default)
    {
        var q = db.Categories.AsNoTracking().Where(c => includeInactive || c.IsActive);
        var rows = await q.OrderBy(c => c.SortOrder).ThenBy(c => c.Name).ToListAsync(ct);
        return rows.Select(c => new Category
        {
            Id = c.Id,
            ParentId = c.ParentId,
            Name = c.Name,
            NameAm = c.NameAm,
            Slug = c.Slug,
            ImageUrl = c.ImageUrl,
            Icon = c.Icon,
            Color = c.Color,
            SortOrder = c.SortOrder,
            IsActive = c.IsActive,
        }).ToList();
    }

    private IQueryable<ProductRow> PublicSource() =>
        db.Products.AsNoTracking().Where(p => p.Status == ProductStatus.Published
            && db.Merchants.Any(m => m.Id == p.MerchantId && m.Status == MerchantStatus.Active && !m.IsTest));

    private static IQueryable<ProductRow> Filter(IQueryable<ProductRow> q, ProductQuery f)
    {
        if (f.MerchantId is { } mid) q = q.Where(p => p.MerchantId == mid);
        if (f.CategoryId is { } cat) q = q.Where(p => p.CategoryId == cat);
        if (f.Featured is { } feat) q = q.Where(p => p.IsFeatured == feat);
        if (f.Status is { } st) q = q.Where(p => p.Status == st);
        // The price on the product card: the discount when there is one, else the base price.
        if (f.MinPrice is { } min) q = q.Where(p => (p.DiscountPrice ?? p.BasePrice) >= min);
        if (f.MaxPrice is { } max) q = q.Where(p => (p.DiscountPrice ?? p.BasePrice) <= max);
        if (!string.IsNullOrWhiteSpace(f.Q))
        {
            var pattern = Like.Contains(f.Q);
            q = q.Where(p => EF.Functions.ILike(p.Name, pattern, Like.Escape)
                || (p.Description != null && EF.Functions.ILike(p.Description, pattern, Like.Escape)));
        }

        return f.Sort switch
        {
            "price_asc" => q.OrderBy(p => p.DiscountPrice ?? p.BasePrice).ThenBy(p => p.Id),
            "price_desc" => q.OrderByDescending(p => p.DiscountPrice ?? p.BasePrice).ThenBy(p => p.Id),
            "name" => q.OrderBy(p => p.Name).ThenBy(p => p.Id),
            _ => q.OrderByDescending(p => p.UpdatedAt).ThenBy(p => p.Id),
        };
    }

    /// <summary>The primary image url (else the first by sort order) of each product, in one query.</summary>
    private async Task<Dictionary<Guid, string>> PrimaryImagesAsync(IReadOnlyCollection<ProductRow> rows, CancellationToken ct)
    {
        var ids = rows.Select(p => p.Id).ToArray();
        var images = await db.Images.AsNoTracking().Where(i => ids.Contains(i.ProductId)).ToListAsync(ct);
        return images.GroupBy(i => i.ProductId)
            .ToDictionary(g => g.Key, g => g.OrderByDescending(i => i.IsPrimary).ThenBy(i => i.SortOrder).First().Url);
    }

    private static ProductSummary ToSummary(ProductRow p, Dictionary<Guid, string> images) => new()
    {
        Id = p.Id,
        MerchantId = p.MerchantId,
        CategoryId = p.CategoryId,
        Name = p.Name,
        Slug = p.Slug,
        BasePrice = p.BasePrice,
        DiscountPrice = p.DiscountPrice,
        IsFeatured = p.IsFeatured,
        ImageUrl = images.GetValueOrDefault(p.Id),
    };

    public async Task<Page<ProductSummary>> ListPublicProductsAsync(ProductQuery query, PageRequest page, CancellationToken ct = default)
    {
        var p = page.Normalized();
        var q = Filter(PublicSource(), query);
        var total = await q.CountAsync(ct);
        var rows = await q.Skip(p.Skip).Take(p.PageSize).ToListAsync(ct);
        var images = await PrimaryImagesAsync(rows, ct);
        return new Page<ProductSummary>(rows.Select(r => ToSummary(r, images)).ToList(), p.Page, p.PageSize, total);
    }

    private async Task<(IReadOnlyList<ProductImage>, IReadOnlyList<ProductVariant>)> ChildrenAsync(Guid productId, CancellationToken ct)
    {
        var images = await db.Images.AsNoTracking().Where(i => i.ProductId == productId).OrderBy(i => i.SortOrder).ToListAsync(ct);
        var variants = await db.Variants.AsNoTracking().Where(v => v.ProductId == productId).OrderByDescending(v => v.IsDefault).ThenBy(v => v.Price).ToListAsync(ct);
        return (
            images.Select(i => new ProductImage(i.Url, i.SortOrder, i.IsPrimary)).ToList(),
            variants.Select(v => new ProductVariant(v.Id, v.Sku, JsonDocument.Parse(v.Attributes).RootElement.Clone(), v.Price, v.DiscountPrice, v.IsDefault)).ToList());
    }

    public async Task<PublicProduct?> GetPublicProductAsync(Guid id, CancellationToken ct = default)
    {
        var row = await PublicSource().Where(p => p.Id == id).FirstOrDefaultAsync(ct);
        if (row is null) return null;
        var (images, variants) = await ChildrenAsync(id, ct);
        var primary = images.OrderByDescending(i => i.IsPrimary).ThenBy(i => i.SortOrder).FirstOrDefault()?.Url;
        return new PublicProduct
        {
            Product = ToSummary(row, primary is null ? [] : new Dictionary<Guid, string> { [row.Id] = primary }),
            Description = row.Description,
            Images = images,
            Variants = variants,
        };
    }

    private static ManagedProductSummary ToManaged(ProductRow p, Dictionary<Guid, string> images) =>
        new() { Product = ToSummary(p, images), Status = p.Status, UpdatedAt = p.UpdatedAt };

    public async Task<Page<ManagedProductSummary>> ListManagedProductsAsync(ProductQuery query, PageRequest page, IReadOnlyCollection<Guid>? onlyMerchantIds, CancellationToken ct = default)
    {
        var p = page.Normalized();
        var source = db.Products.AsNoTracking();
        if (onlyMerchantIds is not null)
        {
            var ids = onlyMerchantIds.ToArray();
            source = source.Where(r => ids.Contains(r.MerchantId));
        }

        var q = Filter(source, query);
        var total = await q.CountAsync(ct);
        var rows = await q.Skip(p.Skip).Take(p.PageSize).ToListAsync(ct);
        var images = await PrimaryImagesAsync(rows, ct);
        return new Page<ManagedProductSummary>(rows.Select(r => ToManaged(r, images)).ToList(), p.Page, p.PageSize, total);
    }

    public async Task<ManagedProduct?> GetManagedProductAsync(Guid id, CancellationToken ct = default)
    {
        var row = await db.Products.AsNoTracking().Where(p => p.Id == id).FirstOrDefaultAsync(ct);
        if (row is null) return null;
        var (images, variants) = await ChildrenAsync(id, ct);
        var primary = images.OrderByDescending(i => i.IsPrimary).ThenBy(i => i.SortOrder).FirstOrDefault()?.Url;
        return new ManagedProduct
        {
            Summary = ToManaged(row, primary is null ? [] : new Dictionary<Guid, string> { [row.Id] = primary }),
            Description = row.Description,
            RejectionReason = row.RejectionReason,
            Images = images,
            Variants = variants,
        };
    }
}
