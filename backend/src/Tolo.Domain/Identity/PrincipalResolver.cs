using Tolo.Domain.Abstractions;
using Tolo.Domain.Services;
using Tolo.Domain.Tolo;

namespace Tolo.Domain.Identity;

/// <summary>
/// Token identity to account. Rules, in order:
/// 1. A subject that is a uuid IS the marketplace profile id (Supabase-issued tokens during the strangler period).
/// 2. Otherwise the subject is a Tolo id: its verified phone (from the token's phone claim, else the Tolo customer directory)
///    is matched ONLY through tolo_phone_links, never profiles.phone, and never to a staff or admin account.
/// ASSUMPTION-BASED until Tolo's developer confirms their token and id format.
/// </summary>
public sealed class PrincipalResolver(IAccountDirectory accounts, PhoneLinkService phoneLinks, IToloCustomerDirectory tolo) : IPrincipalResolver
{
    public async Task<ToloPrincipal?> ResolveAsync(TokenIdentity identity, CancellationToken ct = default)
    {
        if (Guid.TryParse(identity.Subject, out var userId)) return await accounts.LoadAsync(userId, ct);

        var phone = identity.Phone ?? (await tolo.FindByToloIdAsync(identity.Subject, ct))?.Phone;
        if (phone is null) return null;

        var match = await phoneLinks.MatchAsync(phone, ct);
        return match.Match == PhoneMatch.Linked ? await accounts.LoadAsync(match.UserId!.Value, ct) : null;
    }
}
