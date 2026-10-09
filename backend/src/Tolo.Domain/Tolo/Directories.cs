namespace Tolo.Domain.Tolo;

// Anti-corruption layer for Tolo's own data (their MongoDB). Their schema is not known yet, so:
//  - ids are opaque strings (a Mongo ObjectId is a 24-char hex string, but nothing here depends on that);
//  - only the few members this backend provably needs exist, named by what WE need, not by guessed Mongo field names;
//  - every implementation today is a fake. When the schema arrives, one adapter per interface maps their shape to these records
//    and nothing else in the codebase changes.
// See docs/backend/tolo-schema-questions.md.

public sealed record ToloCustomer(string ToloId, string? Phone, string? DisplayName);

public sealed record ToloMerchant(string ToloId, string? BusinessName, string? Phone);

public sealed record ToloDriver(string ToloId, string? DisplayName, string? Phone);

public interface IToloCustomerDirectory
{
    Task<ToloCustomer?> FindByToloIdAsync(string toloId, CancellationToken ct = default);

    Task<ToloCustomer?> FindByPhoneAsync(string normalizedPhone, CancellationToken ct = default);
}

public interface IToloMerchantDirectory
{
    Task<ToloMerchant?> FindByToloIdAsync(string toloId, CancellationToken ct = default);

    Task<ToloMerchant?> FindByPhoneAsync(string normalizedPhone, CancellationToken ct = default);
}

public interface IToloDriverDirectory
{
    Task<ToloDriver?> FindByToloIdAsync(string toloId, CancellationToken ct = default);
}
