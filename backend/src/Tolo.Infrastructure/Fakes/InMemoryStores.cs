using System.Collections.Concurrent;
using Tolo.Domain.Abstractions;
using Tolo.Domain.Identity;

namespace Tolo.Infrastructure.Fakes;

/// <summary>In-memory link table for tests and database-less local runs. The real one is EfPhoneLinkStore.</summary>
public sealed class InMemoryPhoneLinkStore : IPhoneLinkStore
{
    private readonly Dictionary<string, PhoneLinkedAccount> _byPhone = [];
    private readonly Lock _gate = new();

    public void Seed(string phone, Guid userId, bool isStaffOrAdmin = false)
    {
        lock (_gate) _byPhone[phone] = new PhoneLinkedAccount(userId, isStaffOrAdmin);
    }

    public Task<PhoneLinkedAccount?> FindByPhoneAsync(string normalizedPhone, CancellationToken ct = default)
    {
        lock (_gate) return Task.FromResult(_byPhone.GetValueOrDefault(normalizedPhone));
    }

    public Task LinkAsync(Guid userId, string normalizedPhone, CancellationToken ct = default)
    {
        lock (_gate)
        {
            if (_byPhone.ContainsKey(normalizedPhone) || _byPhone.Values.Any(a => a.UserId == userId))
                throw new PhoneAlreadyLinkedException();
            _byPhone[normalizedPhone] = new PhoneLinkedAccount(userId, false);
        }

        return Task.CompletedTask;
    }
}

/// <summary>Accounts held in memory, for tests and database-less local runs. The real one is EfAccountDirectory.</summary>
public sealed class InMemoryAccountDirectory : IAccountDirectory
{
    private readonly ConcurrentDictionary<Guid, ToloPrincipal> _accounts = new();

    public void Add(ToloPrincipal principal) => _accounts[principal.UserId] = principal;

    public Task<ToloPrincipal?> LoadAsync(Guid userId, CancellationToken ct = default) =>
        Task.FromResult(_accounts.GetValueOrDefault(userId));
}
