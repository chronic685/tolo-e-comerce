using System.Collections.Concurrent;
using Tolo.Domain.Tolo;

namespace Tolo.Infrastructure.Fakes;

// Stand-ins for Tolo's MongoDB-backed data. TODO(tolo-data): replace each with an adapter once Tolo's developer sends the schema
// (docs/backend/tolo-schema-questions.md). They hold only what a test or a local run puts in; they decide no business rule.

public sealed class FakeToloCustomerDirectory : IToloCustomerDirectory
{
    private readonly ConcurrentDictionary<string, ToloCustomer> _byId = new();

    public void Add(ToloCustomer customer) => _byId[customer.ToloId] = customer;

    public Task<ToloCustomer?> FindByToloIdAsync(string toloId, CancellationToken ct = default) =>
        Task.FromResult(_byId.GetValueOrDefault(toloId));

    public Task<ToloCustomer?> FindByPhoneAsync(string normalizedPhone, CancellationToken ct = default) =>
        Task.FromResult(_byId.Values.FirstOrDefault(c => c.Phone == normalizedPhone));
}

public sealed class FakeToloMerchantDirectory : IToloMerchantDirectory
{
    private readonly ConcurrentDictionary<string, ToloMerchant> _byId = new();

    public void Add(ToloMerchant merchant) => _byId[merchant.ToloId] = merchant;

    public Task<ToloMerchant?> FindByToloIdAsync(string toloId, CancellationToken ct = default) =>
        Task.FromResult(_byId.GetValueOrDefault(toloId));

    public Task<ToloMerchant?> FindByPhoneAsync(string normalizedPhone, CancellationToken ct = default) =>
        Task.FromResult(_byId.Values.FirstOrDefault(m => m.Phone == normalizedPhone));
}

public sealed class FakeToloDriverDirectory : IToloDriverDirectory
{
    private readonly ConcurrentDictionary<string, ToloDriver> _byId = new();

    public void Add(ToloDriver driver) => _byId[driver.ToloId] = driver;

    public Task<ToloDriver?> FindByToloIdAsync(string toloId, CancellationToken ct = default) =>
        Task.FromResult(_byId.GetValueOrDefault(toloId));
}
