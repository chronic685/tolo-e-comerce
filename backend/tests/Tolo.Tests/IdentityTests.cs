using System.Text;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;
using Tolo.Domain.Identity;
using Tolo.Domain.Services;
using Tolo.Domain.Tolo;
using Tolo.Infrastructure.Fakes;
using Tolo.Infrastructure.Identity;
using Tolo.Tests.Support;

namespace Tolo.Tests;

public sealed class IdentityTests
{
    private static JwtOptions Options(string? key = ApiFactory.SigningKey, string? issuer = ApiFactory.Issuer, string? audience = ApiFactory.Audience) =>
        new() { SigningKey = key, Issuer = issuer, Audience = audience };

    private static JwtIdentityProvider Provider(JwtOptions options, TimeProvider? clock = null) =>
        new(options, new HttpClient(), clock ?? TimeProvider.System);

    [Fact]
    public async Task A_token_from_the_dev_issuer_verifies_and_carries_subject_and_phone()
    {
        var o = Options();
        var token = new DevTokenIssuer(o, TimeProvider.System).Issue("user-1", "+251912345678");
        var id = await Provider(o).ValidateAsync(token);
        Assert.Equal(new TokenIdentity("user-1", "+251912345678"), id);
    }

    [Fact]
    public async Task Wrong_key_issuer_audience_or_expiry_are_rejected()
    {
        var good = Options();
        var provider = Provider(good);

        Assert.Null(await provider.ValidateAsync(new DevTokenIssuer(Options(key: "another-key-another-key-another-key-123"), TimeProvider.System).Issue("u")));
        Assert.Null(await provider.ValidateAsync(new DevTokenIssuer(Options(issuer: "https://evil.test"), TimeProvider.System).Issue("u")));
        Assert.Null(await provider.ValidateAsync(new DevTokenIssuer(Options(audience: "someone-else"), TimeProvider.System).Issue("u")));

        var past = new TestTime();
        past.Advance(TimeSpan.FromDays(-3000));
        Assert.Null(await provider.ValidateAsync(new DevTokenIssuer(good, past).Issue("u", lifetime: TimeSpan.FromMinutes(5))));
    }

    [Fact]
    public async Task An_unsigned_token_is_rejected()
    {
        var header = Convert.ToBase64String(Encoding.UTF8.GetBytes("""{"alg":"none","typ":"JWT"}""")).TrimEnd('=');
        var exp = DateTimeOffset.UtcNow.AddHours(1).ToUnixTimeSeconds();
        var payload = Convert.ToBase64String(Encoding.UTF8.GetBytes($$"""{"sub":"u","iss":"{{ApiFactory.Issuer}}","aud":"{{ApiFactory.Audience}}","exp":{{exp}}}""")).TrimEnd('=');
        Assert.Null(await Provider(Options()).ValidateAsync($"{header}.{payload}."));
    }

    [Fact]
    public async Task A_token_signed_with_an_unexpected_algorithm_is_rejected()
    {
        var o = Options();
        var hs512 = new JsonWebTokenHandler().CreateToken(new SecurityTokenDescriptor
        {
            Issuer = o.Issuer,
            Audience = o.Audience,
            Expires = DateTime.UtcNow.AddHours(1),
            Claims = new Dictionary<string, object> { ["sub"] = "u" },
            SigningCredentials = new SigningCredentials(new SymmetricSecurityKey(Encoding.UTF8.GetBytes(o.SigningKey! + o.SigningKey!)), SecurityAlgorithms.HmacSha512),
        });
        Assert.Null(await Provider(o).ValidateAsync(hs512));
    }

    [Theory]
    [InlineData(null, "iss", "aud")]
    [InlineData("key-key-key-key-key-key-key-key-key", null, "aud")]
    [InlineData("key-key-key-key-key-key-key-key-key", "iss", null)]
    public async Task An_unconfigured_provider_rejects_everything(string? key, string? issuer, string? audience)
    {
        var o = Options(ApiFactory.SigningKey);
        var token = new DevTokenIssuer(o, TimeProvider.System).Issue("u");
        Assert.Null(await Provider(Options(key, issuer, audience)).ValidateAsync(token));
        Assert.Null(await Provider(Options(key, issuer, audience)).ValidateAsync(""));
    }

    [Fact]
    public void The_dev_issuer_refuses_to_run_without_a_key()
    {
        Assert.Throws<InvalidOperationException>(() => new DevTokenIssuer(Options(key: null), TimeProvider.System).Issue("u"));
    }

    // --- subject to account (PrincipalResolver) ---

    private sealed class Rig
    {
        public InMemoryAccountDirectory Accounts { get; } = new();
        public InMemoryPhoneLinkStore Links { get; } = new();
        public FakeToloCustomerDirectory Tolo { get; } = new();

        public PrincipalResolver Resolver => new(Accounts, new PhoneLinkService(Links), Tolo);
    }

    [Fact]
    public async Task A_uuid_subject_is_the_marketplace_profile_id()
    {
        var rig = new Rig();
        var id = Guid.NewGuid();
        rig.Accounts.Add(new ToloPrincipal { UserId = id, Roles = new HashSet<string> { Roles.Customer } });
        var who = await rig.Resolver.ResolveAsync(new TokenIdentity(id.ToString(), null));
        Assert.Equal(id, who?.UserId);
        Assert.Null(await rig.Resolver.ResolveAsync(new TokenIdentity(Guid.NewGuid().ToString(), null)));
    }

    [Fact]
    public async Task A_tolo_subject_resolves_through_its_verified_phone_and_the_phone_link_only()
    {
        var rig = new Rig();
        var id = Guid.NewGuid();
        rig.Accounts.Add(new ToloPrincipal { UserId = id, Roles = new HashSet<string> { Roles.Customer } });
        rig.Links.Seed("+251912345678", id);
        rig.Tolo.Add(new ToloCustomer("64f0c0ffee0000000000abcd", "0912345678", "Abebe"));

        // phone claim in the token
        Assert.Equal(id, (await rig.Resolver.ResolveAsync(new TokenIdentity("tolo-123", "251912345678")))?.UserId);
        // no phone claim: the Tolo customer directory supplies the phone
        Assert.Equal(id, (await rig.Resolver.ResolveAsync(new TokenIdentity("64f0c0ffee0000000000abcd", null)))?.UserId);
        // unknown Tolo id and no phone, or a phone nobody linked
        Assert.Null(await rig.Resolver.ResolveAsync(new TokenIdentity("who", null)));
        Assert.Null(await rig.Resolver.ResolveAsync(new TokenIdentity("tolo-9", "0922222222")));
    }

    [Fact]
    public async Task A_tolo_phone_linked_to_staff_or_admin_never_resolves()
    {
        var rig = new Rig();
        var admin = Guid.NewGuid();
        rig.Accounts.Add(new ToloPrincipal { UserId = admin, Roles = new HashSet<string> { Roles.SuperAdmin } });
        rig.Links.Seed("+251912345678", admin, isStaffOrAdmin: true);
        Assert.Null(await rig.Resolver.ResolveAsync(new TokenIdentity("tolo-1", "0912345678")));
    }
}
