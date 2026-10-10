namespace Tolo.Domain.Abstractions;

/// <summary>An account that a verified phone is linked to (row of tolo_phone_links joined to its profile).</summary>
public sealed record PhoneLinkedAccount(Guid UserId, bool IsStaffOrAdmin);

/// <summary>Another account already holds this phone's link (unique violation on tolo_phone_links.phone or user_id).</summary>
public sealed class PhoneAlreadyLinkedException() : Exception("phone_already_linked");

/// <summary>
/// Access to tolo_phone_links (supabase/migrations/0072_tolo_phone_links.sql). The marketplace database owns the table;
/// this interface only exposes the two operations the migration's functions offer, tolo_account_for_phone() and
/// link_tolo_phone(). There is deliberately no update or delete, and nothing here ever reads profiles.phone.
/// </summary>
public interface IPhoneLinkStore
{
    Task<PhoneLinkedAccount?> FindByPhoneAsync(string normalizedPhone, CancellationToken ct = default);

    /// <exception cref="PhoneAlreadyLinkedException">The phone or the account is already linked.</exception>
    Task LinkAsync(Guid userId, string normalizedPhone, CancellationToken ct = default);
}
