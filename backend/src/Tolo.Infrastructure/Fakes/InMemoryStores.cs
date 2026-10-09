using System.Collections.Concurrent;
using Tolo.Domain.Abstractions;
using Tolo.Domain.Contracts;

namespace Tolo.Infrastructure.Fakes;

// Everything in this file is a stand-in for Tolo-owned data that does not exist in this repo yet.
// None of it persists, none of it is shared between processes, and none of it decides a business rule.

/// <summary>TODO(tolo-data): replace with a table-backed store. In-memory codes vanish on restart and are per instance.</summary>
public sealed class InMemoryLoginCodeStore : ILoginCodeStore
{
    private sealed class Entry(string customerId, DateTimeOffset expiresAt)
    {
        public string CustomerId { get; } = customerId;
        public DateTimeOffset ExpiresAt { get; } = expiresAt;
        public bool Used { get; set; }
    }

    private readonly Dictionary<string, Entry> _codes = [];
    private readonly Lock _gate = new();

    public Task StoreAsync(string codeHash, string customerId, DateTimeOffset expiresAt, CancellationToken ct = default)
    {
        lock (_gate) _codes[codeHash] = new Entry(customerId, expiresAt);
        return Task.CompletedTask;
    }

    public Task<RedeemResult> RedeemAsync(string codeHash, DateTimeOffset now, CancellationToken ct = default)
    {
        lock (_gate)
        {
            if (!_codes.TryGetValue(codeHash, out var e)) return Task.FromResult(new RedeemResult(RedeemOutcome.Unknown));
            if (e.Used) return Task.FromResult(new RedeemResult(RedeemOutcome.AlreadyUsed));
            // Redeeming spends the code even when it has expired, so a late replay reads as already_used.
            e.Used = true;
            return Task.FromResult(e.ExpiresAt <= now
                ? new RedeemResult(RedeemOutcome.Expired)
                : new RedeemResult(RedeemOutcome.Redeemed, e.CustomerId));
        }
    }
}

/// <summary>TODO(tolo-data): replace with the Tolo customer table. Seeded by hand in dev and tests only.</summary>
public sealed class InMemoryCustomerDirectory : ICustomerDirectory
{
    private readonly ConcurrentDictionary<string, VerifiedCustomer> _customers = new();

    public void Add(VerifiedCustomer customer) => _customers[customer.CustomerId] = customer;

    public Task<VerifiedCustomer?> FindAsync(string customerId, CancellationToken ct = default) =>
        Task.FromResult(_customers.TryGetValue(customerId, out var c) ? c : null);
}

/// <summary>TODO(tolo-data): replace with the Tolo driver dispatch tables. Jobs are accepted and then forgotten on restart.</summary>
public sealed class InMemoryDeliveryJobStore : IDeliveryJobStore
{
    private readonly ConcurrentDictionary<Guid, DeliveryJobRequest> _jobs = new();

    public IReadOnlyCollection<DeliveryJobRequest> Jobs => _jobs.Values.ToArray();

    public Task<bool> AddIfAbsentAsync(Guid jobId, DeliveryJobRequest job, CancellationToken ct = default) =>
        Task.FromResult(_jobs.TryAdd(jobId, job));
}

/// <summary>In-memory link table for tests and local runs without a database. The real one is EfPhoneLinkStore.</summary>
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
