using System.Security.Cryptography;
using System.Text;
using Tolo.Domain.Abstractions;
using Tolo.Domain.Contracts;

namespace Tolo.Domain.Services;

/// <summary>
/// Issues and redeems the one-time codes of the login handoff (docs/integration/tolo-app.md).
/// Only the phone and name that come from the customer directory are ever returned: nothing in a request supplies identity.
/// </summary>
public sealed class LoginCodeService(ILoginCodeStore codes, ICustomerDirectory customers, TimeProvider clock, TimeSpan ttl)
{
    /// <summary>Issues a code for an authenticated Tolo customer. The code is returned once and stored only as a hash.</summary>
    public async Task<string> IssueAsync(string customerId, CancellationToken ct = default)
    {
        var code = Base64Url(RandomNumberGenerator.GetBytes(32));
        await codes.StoreAsync(Hash(code), customerId, clock.GetUtcNow() + ttl, ct);
        return code;
    }

    public async Task<VerifyCodeResponse> VerifyAsync(string? code, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(code)) return VerifyCodeResponse.Rejected(VerifyCodeReasons.InvalidCode);

        var result = await codes.RedeemAsync(Hash(code), clock.GetUtcNow(), ct);
        switch (result.Outcome)
        {
            case RedeemOutcome.AlreadyUsed:
                return VerifyCodeResponse.Rejected(VerifyCodeReasons.AlreadyUsed);
            case RedeemOutcome.Expired:
                return VerifyCodeResponse.Rejected(VerifyCodeReasons.ExpiredCode);
            case RedeemOutcome.Unknown:
                return VerifyCodeResponse.Rejected(VerifyCodeReasons.InvalidCode);
        }

        var customer = await customers.FindAsync(result.CustomerId!, ct);
        var phone = PhoneNumber.NormalizeEthiopian(customer?.Phone);
        // A code for a customer that is gone or has no usable verified phone is spent, and reads as invalid.
        if (customer is null || phone is null) return VerifyCodeResponse.Rejected(VerifyCodeReasons.InvalidCode);
        return VerifyCodeResponse.Ok(phone, customer.Name);
    }

    public static string Hash(string code) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(code)));

    private static string Base64Url(byte[] bytes) =>
        Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
}
