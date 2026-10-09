using Tolo.Domain.Contracts;

namespace Tolo.Domain.Abstractions;

public enum RedeemOutcome
{
    Redeemed,
    Unknown,
    Expired,
    AlreadyUsed,
}

public sealed record RedeemResult(RedeemOutcome Outcome, string? CustomerId = null);

/// <summary>
/// One-time login codes. Only a hash of the code is ever stored. <see cref="RedeemAsync"/> must be atomic: of two
/// concurrent redemptions of the same code exactly one gets <see cref="RedeemOutcome.Redeemed"/>.
/// </summary>
public interface ILoginCodeStore
{
    Task StoreAsync(string codeHash, string customerId, DateTimeOffset expiresAt, CancellationToken ct = default);

    /// <summary>Marks the code used as it redeems it. A used code stays used, expired or not.</summary>
    Task<RedeemResult> RedeemAsync(string codeHash, DateTimeOffset now, CancellationToken ct = default);
}

public sealed record VerifiedCustomer(string CustomerId, string Phone, string Name);

/// <summary>
/// The Tolo customer accounts. TODO(tolo-data): the real implementation reads the Tolo Delivery app's own customer
/// table; none exists in this repo, so Phase 1 ships an in-memory fake. Phone must be the phone Tolo verified.
/// </summary>
public interface ICustomerDirectory
{
    Task<VerifiedCustomer?> FindAsync(string customerId, CancellationToken ct = default);
}

/// <summary>
/// Where received delivery jobs go. TODO(tolo-data): the real implementation creates the job in the Tolo driver
/// dispatch tables; those do not exist yet, so Phase 1 ships an in-memory fake.
/// </summary>
public interface IDeliveryJobStore
{
    /// <summary>Stores the job unless a job with the same id exists. Returns true when this call created it.</summary>
    Task<bool> AddIfAbsentAsync(Guid jobId, DeliveryJobRequest job, CancellationToken ct = default);
}

/// <summary>Server-to-server calls from this backend to the marketplace's Edge Functions.</summary>
public interface IMarketplaceClient
{
    /// <summary>merchant-application-status. Throws <see cref="MarketplaceUnavailableException"/> on any non-200 or network error.</summary>
    Task<MerchantApplicationStatus> GetMerchantApplicationStatusAsync(string verifiedPhone, CancellationToken ct = default);

    /// <summary>delivery-status-callback. Throws <see cref="MarketplaceUnavailableException"/> on a network error or 5xx; a 4xx is not retryable and throws <see cref="MarketplaceRejectedException"/>.</summary>
    Task SendDeliveryStatusAsync(DeliveryStatusCallback callback, CancellationToken ct = default);
}

/// <summary>The marketplace could not be reached or failed. Callers treat it as "don't change anything", never as an answer.</summary>
public sealed class MarketplaceUnavailableException(string message, Exception? inner = null) : Exception(message, inner);

/// <summary>The marketplace understood the call and refused it (4xx). Do not retry.</summary>
public sealed class MarketplaceRejectedException(int statusCode) : Exception($"Marketplace rejected the call with HTTP {statusCode}.")
{
    public int StatusCode { get; } = statusCode;
}
