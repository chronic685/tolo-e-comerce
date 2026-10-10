using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Tolo.Domain.Identity;

namespace Tolo.Infrastructure.Persistence;

/// <summary>
/// Reads an account's roles with the same rules the database applies (is_tolo_admin, has_admin_page, is_merchant_member):
/// admin_tier gives admin or super_admin; a tolo_* role gives staff with the pages in profiles.permissions; role customer gives customer;
/// ownership of a merchant or a merchant_staff row gives the merchant roles. A suspended or otherwise inactive account has no roles at all.
/// </summary>
public sealed class EfAccountDirectory(ToloDbContext db) : IAccountDirectory
{
    private sealed record ProfileRecord(string Role, string? AdminTier, string AccountStatus, string Permissions);

    public async Task<ToloPrincipal?> LoadAsync(Guid userId, CancellationToken ct = default)
    {
        var profile = await db.Database.SqlQuery<ProfileRecord>($"""
            select role::text as "Role", admin_tier as "AdminTier", account_status::text as "AccountStatus", permissions::text as "Permissions"
            from profiles where id = {userId}
            """).FirstOrDefaultAsync(ct);
        if (profile is null || profile.AccountStatus != "active") return null;

        var owned = await db.Database.SqlQuery<Guid>($"""select id as "Value" from merchants where owner_id = {userId}""").ToListAsync(ct);
        var worksFor = await db.Database.SqlQuery<Guid>($"""select merchant_id as "Value" from merchant_staff where user_id = {userId}""").ToListAsync(ct);

        var roles = new HashSet<string>();
        if (profile.AdminTier == "super_admin") { roles.Add(Roles.SuperAdmin); roles.Add(Roles.Admin); }
        else if (profile.AdminTier == "admin") roles.Add(Roles.Admin);
        else if (profile.Role.StartsWith("tolo_", StringComparison.Ordinal)) roles.Add(Roles.Staff);
        else if (profile.Role == "customer") roles.Add(Roles.Customer);
        if (owned.Count > 0) roles.Add(Roles.MerchantOwner);
        if (worksFor.Except(owned).Any()) roles.Add(Roles.MerchantStaff);

        return new ToloPrincipal
        {
            UserId = userId,
            Roles = roles,
            Pages = ParsePages(profile.Permissions),
            MerchantIds = owned.Concat(worksFor).ToHashSet(),
        };
    }

    private static HashSet<string> ParsePages(string json)
    {
        try
        {
            using var doc = JsonDocument.Parse(json);
            return doc.RootElement.ValueKind == JsonValueKind.Array
                ? doc.RootElement.EnumerateArray().Where(e => e.ValueKind == JsonValueKind.String).Select(e => e.GetString()!).ToHashSet()
                : [];
        }
        catch (JsonException)
        {
            return [];
        }
    }
}
