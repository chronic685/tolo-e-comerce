namespace Tolo.Api.Auth;

/// <summary>
/// Who the signed-in Tolo app customer is, for the /app routes.
/// TODO(tolo-auth): the Tolo app's real session or token scheme is not documented anywhere in this repo. Until it is,
/// the only implementations are "not configured" (the /app routes answer 501) and a fake for local dev and tests.
/// </summary>
public interface IAppAuthenticator
{
    bool IsConfigured { get; }

    /// <summary>The authenticated customer's id, or null when the request is not authenticated.</summary>
    string? CustomerId(HttpContext context);
}

public sealed class NotConfiguredAppAuthenticator : IAppAuthenticator
{
    public bool IsConfigured => false;

    public string? CustomerId(HttpContext context) => null;
}

/// <summary>Dev/test only (TOLO_ALLOW_FAKE_APP_AUTH=true): trusts X-Fake-Customer-Id. Never enable it anywhere real.</summary>
public sealed class FakeAppAuthenticator : IAppAuthenticator
{
    public bool IsConfigured => true;

    public string? CustomerId(HttpContext context)
    {
        var id = context.Request.Headers["X-Fake-Customer-Id"].ToString();
        return id.Length == 0 ? null : id;
    }
}
