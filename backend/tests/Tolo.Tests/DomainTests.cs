using Microsoft.Extensions.Logging.Abstractions;
using Tolo.Domain;
using Tolo.Domain.Abstractions;
using Tolo.Domain.Common;
using Tolo.Domain.Identity;
using Tolo.Domain.Services;
using Tolo.Infrastructure.Fakes;
using Tolo.Worker;

namespace Tolo.Tests;

public sealed class DomainTests
{
    [Theory]
    [InlineData("0912345678", "+251912345678")]
    [InlineData("251912345678", "+251912345678")]
    [InlineData("+251912345678", "+251912345678")]
    [InlineData("+251 91-234 (5678)", "+251912345678")]
    [InlineData("0712345678", "+251712345678")]
    [InlineData("912345678", "+251912345678")]
    [InlineData("0812345678", null)]
    [InlineData("091234567", null)]
    [InlineData("+14155550100", null)]
    [InlineData("", null)]
    [InlineData(null, null)]
    public void Phone_normalization_matches_the_edge_function(string? input, string? expected) =>
        Assert.Equal(expected, PhoneNumber.NormalizeEthiopian(input));

    // --- roles: the C# twin of has_admin_page() ---

    private static ToloPrincipal Who(params string[] roles) => new() { UserId = Guid.NewGuid(), Roles = roles.ToHashSet() };

    [Fact]
    public void Admin_tiers_reach_every_page_and_staff_only_the_pages_they_hold()
    {
        Assert.True(Who(Roles.Admin).HasAdminPage("anything"));
        Assert.True(Who(Roles.SuperAdmin).HasAdminPage("anything"));

        var staff = Who(Roles.Staff) with { Pages = new HashSet<string> { "orders", "merchants" } };
        Assert.True(staff.HasAdminPage("merchants"));
        Assert.True(staff.HasAdminPage("products", "orders")); // any of the keys, like has_admin_page(array[...])
        Assert.False(staff.HasAdminPage("products"));
    }

    [Fact]
    public void Pages_mean_nothing_without_the_staff_role()
    {
        var customerWithPages = Who(Roles.Customer) with { Pages = new HashSet<string> { "merchants" } };
        Assert.False(customerWithPages.HasAdminPage("merchants"));
        Assert.False(Who(Roles.MerchantOwner).HasAdminPage("merchants"));
    }

    [Fact]
    public void Merchant_membership_is_per_merchant()
    {
        var mine = Guid.NewGuid();
        var who = Who(Roles.MerchantOwner) with { MerchantIds = new HashSet<Guid> { mine } };
        Assert.True(who.IsMemberOf(mine));
        Assert.False(who.IsMemberOf(Guid.NewGuid()));
    }

    [Theory]
    [InlineData(0, 0, 1, 20)]
    [InlineData(-5, 500, 1, 100)]
    [InlineData(3, 10, 3, 10)]
    public void Paging_is_clamped(int page, int size, int expectedPage, int expectedSize)
    {
        var p = new PageRequest(page, size).Normalized();
        Assert.Equal((expectedPage, expectedSize), (p.Page, p.PageSize));
        Assert.Equal((expectedPage - 1) * expectedSize, p.Skip);
    }

    // --- tolo_phone_links protection (migration 0072) ---

    private static (PhoneLinkService svc, InMemoryPhoneLinkStore store) Links()
    {
        var store = new InMemoryPhoneLinkStore();
        return (new PhoneLinkService(store), store);
    }

    [Fact]
    public async Task A_linked_phone_matches_its_account_in_any_format()
    {
        var (svc, store) = Links();
        var id = Guid.NewGuid();
        store.Seed("+251912345678", id);
        var m = await svc.MatchAsync("0912 345 678");
        Assert.Equal(PhoneMatch.Linked, m.Match);
        Assert.Equal(id, m.UserId);
    }

    [Fact]
    public async Task An_unlinked_phone_is_NoLink_and_never_guessed_from_anything_else()
    {
        var (svc, _) = Links();
        Assert.Equal(PhoneMatch.NoLink, (await svc.MatchAsync("0912345678")).Match);
    }

    [Fact]
    public async Task A_phone_linked_to_staff_or_admin_is_blocked()
    {
        var (svc, store) = Links();
        store.Seed("+251912345678", Guid.NewGuid(), isStaffOrAdmin: true);
        var m = await svc.MatchAsync("+251912345678");
        Assert.Equal(PhoneMatch.Blocked, m.Match);
        Assert.Null(m.UserId);
    }

    [Fact]
    public async Task An_unnormalizable_phone_is_rejected()
    {
        var (svc, _) = Links();
        Assert.Equal(PhoneMatch.InvalidPhone, (await svc.MatchAsync("12345")).Match);
    }

    [Fact]
    public async Task A_second_account_cannot_take_over_a_linked_phone_and_an_account_has_one_phone()
    {
        var (svc, _) = Links();
        var victim = Guid.NewGuid();
        await svc.LinkNewAccountAsync(victim, "0912345678");

        await Assert.ThrowsAsync<PhoneAlreadyLinkedException>(() => svc.LinkNewAccountAsync(Guid.NewGuid(), "+251912345678"));
        await Assert.ThrowsAsync<PhoneAlreadyLinkedException>(() => svc.LinkNewAccountAsync(victim, "0922222222"));
        Assert.Equal(victim, (await svc.MatchAsync("+251912345678")).UserId);
    }

    [Fact]
    public async Task Linking_requires_a_valid_phone()
    {
        var (svc, _) = Links();
        await Assert.ThrowsAsync<ArgumentException>(() => svc.LinkNewAccountAsync(Guid.NewGuid(), "nope"));
    }

    // --- worker skeleton ---

    private sealed class FailingJob : IScheduledJob
    {
        public string Name => "failing";

        public TimeSpan Interval => TimeSpan.FromMinutes(1);

        public Task RunAsync(CancellationToken ct) => throw new InvalidOperationException("boom");
    }

    [Fact]
    public async Task A_failing_job_is_contained_and_the_sample_job_runs()
    {
        var scheduler = new JobScheduler([], NullLogger<JobScheduler>.Instance);
        await scheduler.RunOnceAsync(new FailingJob(), CancellationToken.None);
        await scheduler.RunOnceAsync(new HeartbeatJob(NullLogger<HeartbeatJob>.Instance), CancellationToken.None);
    }
}
