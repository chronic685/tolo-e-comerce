using Microsoft.EntityFrameworkCore;
using Npgsql;
using Tolo.Domain.Abstractions;

namespace Tolo.Infrastructure.Persistence;

/// <summary>
/// tolo_phone_links through the two SQL functions migration 0072 defines, so the staff/admin rule and the uniqueness
/// handling live in exactly one place (the migration) and cannot drift from this code.
/// The database role this connects as needs EXECUTE on them (0072 grants them to the service role only).
/// </summary>
public sealed class EfPhoneLinkStore(ToloDbContext db) : IPhoneLinkStore
{
    private sealed record AccountRow(Guid user_id, bool is_staff_or_admin);

    public async Task<PhoneLinkedAccount?> FindByPhoneAsync(string normalizedPhone, CancellationToken ct = default)
    {
        var rows = await db.Database
            .SqlQuery<AccountRow>($"select user_id, is_staff_or_admin from tolo_account_for_phone({normalizedPhone})")
            .ToListAsync(ct);
        return rows.Count == 0 ? null : new PhoneLinkedAccount(rows[0].user_id, rows[0].is_staff_or_admin);
    }

    public async Task LinkAsync(Guid userId, string normalizedPhone, CancellationToken ct = default)
    {
        try
        {
            await db.Database.ExecuteSqlAsync($"select link_tolo_phone({userId}, {normalizedPhone})", ct);
        }
        catch (PostgresException ex) when (ex.MessageText == "phone_already_linked")
        {
            throw new PhoneAlreadyLinkedException();
        }
    }
}
