using Tolo.Domain.Abstractions;

namespace Tolo.Domain.Services;

public enum PhoneMatch
{
    /// <summary>The phone is linked to an ordinary account: that account may sign in.</summary>
    Linked,
    /// <summary>No account is linked to this phone yet (a first login creates one and links it).</summary>
    NoLink,
    /// <summary>The phone is linked to a staff or admin account. Reject with the same generic failure as an invalid code.</summary>
    Blocked,
    /// <summary>The phone did not normalize. Reject.</summary>
    InvalidPhone,
}

public sealed record PhoneMatchResult(PhoneMatch Match, Guid? UserId = null);

/// <summary>
/// The phone-hijack protection of migration 0072, as rules. A Tolo-verified phone maps to an account only through
/// tolo_phone_links; the self-editable profiles.phone is never consulted (anyone could set it to a victim's number).
/// Building block for the phase that ports tolo-app-login; Phase 1 does not expose it over HTTP.
/// </summary>
public sealed class PhoneLinkService(IPhoneLinkStore links)
{
    public async Task<PhoneMatchResult> MatchAsync(string verifiedPhone, CancellationToken ct = default)
    {
        var phone = PhoneNumber.NormalizeEthiopian(verifiedPhone);
        if (phone is null) return new PhoneMatchResult(PhoneMatch.InvalidPhone);

        var account = await links.FindByPhoneAsync(phone, ct);
        if (account is null) return new PhoneMatchResult(PhoneMatch.NoLink);
        return account.IsStaffOrAdmin
            ? new PhoneMatchResult(PhoneMatch.Blocked)
            : new PhoneMatchResult(PhoneMatch.Linked, account.UserId);
    }

    /// <summary>Links a freshly created account to the phone it was created for. Throws <see cref="PhoneAlreadyLinkedException"/> if another account won the race.</summary>
    public async Task LinkNewAccountAsync(Guid userId, string verifiedPhone, CancellationToken ct = default)
    {
        var phone = PhoneNumber.NormalizeEthiopian(verifiedPhone)
            ?? throw new ArgumentException("verifiedPhone is not a valid Ethiopian mobile number.", nameof(verifiedPhone));
        await links.LinkAsync(userId, phone, ct);
    }
}
