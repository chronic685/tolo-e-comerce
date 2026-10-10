using Microsoft.EntityFrameworkCore;
using Tolo.Domain.Common;
using Tolo.Domain.Merchants;

namespace Tolo.Infrastructure.Persistence;

public sealed class EfMerchantReader(ToloDbContext db) : IMerchantReader
{
    private IQueryable<MerchantRow> ActivePublic() => db.Merchants.AsNoTracking().Where(m => m.Status == MerchantStatus.Active && !m.IsTest);

    private IQueryable<MerchantRow> Filter(IQueryable<MerchantRow> q, MerchantQuery f)
    {
        if (f.CategoryId is { } cat) q = q.Where(m => m.CategoryId == cat);
        if (!string.IsNullOrWhiteSpace(f.City))
        {
            var city = Like.Exact(f.City);
            q = q.Where(m => m.City != null && EF.Functions.ILike(m.City, city, Like.Escape));
        }

        if (f.Status is { } st) q = q.Where(m => m.Status == st);
        if (!string.IsNullOrWhiteSpace(f.Q))
        {
            var pattern = Like.Contains(f.Q);
            q = q.Where(m => EF.Functions.ILike(m.BusinessName, pattern, Like.Escape)
                || db.Stores.Any(s => s.MerchantId == m.Id && EF.Functions.ILike(s.Name, pattern, Like.Escape)));
        }

        return f.Sort == "name"
            ? q.OrderBy(m => m.BusinessName).ThenBy(m => m.Id)
            : q.OrderByDescending(m => m.CreatedAt).ThenBy(m => m.Id);
    }

    /// <summary>Category names and storefronts for a set of merchants, in two small queries instead of joins.</summary>
    private async Task<(Dictionary<Guid, string> Categories, Dictionary<Guid, StoreInfo> Stores)> LookupsAsync(IReadOnlyCollection<MerchantRow> rows, CancellationToken ct)
    {
        var categoryIds = rows.Where(m => m.CategoryId != null).Select(m => m.CategoryId!.Value).Distinct().ToArray();
        var merchantIds = rows.Select(m => m.Id).ToArray();
        var categories = await db.Categories.AsNoTracking().Where(c => categoryIds.Contains(c.Id)).ToDictionaryAsync(c => c.Id, c => c.Name, ct);
        var stores = await db.Stores.AsNoTracking().Where(s => merchantIds.Contains(s.MerchantId)).ToListAsync(ct);
        return (categories, stores.GroupBy(s => s.MerchantId).ToDictionary(g => g.Key, g => ToStore(g.First())));
    }

    private static StoreInfo ToStore(StoreRow s) => new(s.Name, s.Slug, s.LogoUrl, s.BannerUrl, s.Description);

    private static string? CategoryName(Dictionary<Guid, string> categories, Guid? id) => id is { } k && categories.TryGetValue(k, out var n) ? n : null;

    private static PublicMerchant ToPublic(MerchantRow m, Dictionary<Guid, string> categories, Dictionary<Guid, StoreInfo> stores) => new()
    {
        Id = m.Id,
        BusinessName = m.BusinessName,
        CategoryId = m.CategoryId,
        CategoryName = CategoryName(categories, m.CategoryId),
        Location = m.Location,
        City = m.City,
        SubCity = m.SubCity,
        Woreda = m.Woreda,
        Landmark = m.Landmark,
        Latitude = m.Latitude,
        Longitude = m.Longitude,
        CreatedAt = m.CreatedAt,
        Store = stores.GetValueOrDefault(m.Id),
    };

    private static ManagedMerchantSummary ToManaged(MerchantRow m, Dictionary<Guid, string> categories) => new()
    {
        Id = m.Id,
        OwnerId = m.OwnerId,
        BusinessName = m.BusinessName,
        CategoryId = m.CategoryId,
        CategoryName = CategoryName(categories, m.CategoryId),
        Status = m.Status,
        IsTest = m.IsTest,
        Location = m.Location,
        City = m.City,
        CreatedAt = m.CreatedAt,
    };

    public async Task<Page<PublicMerchant>> ListPublicAsync(MerchantQuery query, PageRequest page, CancellationToken ct = default)
    {
        var p = page.Normalized();
        var q = Filter(ActivePublic(), query);
        var total = await q.CountAsync(ct);
        var rows = await q.Skip(p.Skip).Take(p.PageSize).ToListAsync(ct);
        var (categories, stores) = await LookupsAsync(rows, ct);
        return new Page<PublicMerchant>(rows.Select(m => ToPublic(m, categories, stores)).ToList(), p.Page, p.PageSize, total);
    }

    public async Task<PublicMerchant?> GetPublicAsync(Guid id, CancellationToken ct = default)
    {
        var row = await ActivePublic().Where(m => m.Id == id).FirstOrDefaultAsync(ct);
        if (row is null) return null;
        var (categories, stores) = await LookupsAsync([row], ct);
        return ToPublic(row, categories, stores);
    }

    public async Task<Page<ManagedMerchantSummary>> ListManagedAsync(MerchantQuery query, PageRequest page, IReadOnlyCollection<Guid>? onlyIds, CancellationToken ct = default)
    {
        var p = page.Normalized();
        var source = db.Merchants.AsNoTracking();
        if (onlyIds is not null)
        {
            var ids = onlyIds.ToArray();
            source = source.Where(m => ids.Contains(m.Id));
        }

        var q = Filter(source, query);
        var total = await q.CountAsync(ct);
        var rows = await q.Skip(p.Skip).Take(p.PageSize).ToListAsync(ct);
        var (categories, _) = await LookupsAsync(rows, ct);
        return new Page<ManagedMerchantSummary>(rows.Select(m => ToManaged(m, categories)).ToList(), p.Page, p.PageSize, total);
    }

    private sealed record ContactRow(string? Phone, string? Email, string? OwnerFullName, string? OwnerPhone, string? OwnerEmail, string? BusinessRegistrationNumber);

    public async Task<ManagedMerchant?> GetManagedAsync(Guid id, CancellationToken ct = default)
    {
        var row = await db.Merchants.AsNoTracking().Where(m => m.Id == id).FirstOrDefaultAsync(ct);
        if (row is null) return null;
        var (categories, stores) = await LookupsAsync([row], ct);

        // The ONLY place the private columns are read. Column aliases match ContactRow's property names.
        var contact = await db.Database.SqlQuery<ContactRow>($"""
            select phone as "Phone", email as "Email", owner_full_name as "OwnerFullName", owner_phone as "OwnerPhone",
                   owner_email as "OwnerEmail", business_registration_number as "BusinessRegistrationNumber"
            from merchants where id = {id}
            """).FirstAsync(ct);

        return new ManagedMerchant
        {
            Merchant = ToManaged(row, categories),
            Store = stores.GetValueOrDefault(row.Id),
            Contact = new MerchantContact(contact.Phone, contact.Email, contact.OwnerFullName, contact.OwnerPhone, contact.OwnerEmail, contact.BusinessRegistrationNumber),
            RejectionReason = row.RejectionReason,
            SuspensionReason = row.SuspensionReason,
        };
    }
}

/// <summary>Builds safe ILIKE patterns from user input: % and _ typed by the caller match themselves.</summary>
internal static class Like
{
    public const string Escape = "\\";

    public static string Contains(string input) => "%" + Exact(input) + "%";

    public static string Exact(string input) =>
        input.Trim().Replace("\\", "\\\\", StringComparison.Ordinal).Replace("%", "\\%", StringComparison.Ordinal).Replace("_", "\\_", StringComparison.Ordinal);
}
