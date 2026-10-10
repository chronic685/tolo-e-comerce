namespace Tolo.Domain.Identity;

/// <summary>The roles of today's rules (supabase/migrations 0013, 0050, 0051). A person can hold several: a merchant owner is also a customer.</summary>
public static class Roles
{
    public const string Customer = "customer";
    public const string MerchantOwner = "merchant_owner";
    public const string MerchantStaff = "merchant_staff";

    /// <summary>A tolo_* account whose reach is the list of pages in its permissions (has_admin_page()).</summary>
    public const string Staff = "staff";
    public const string Admin = "admin";
    public const string SuperAdmin = "super_admin";
}

/// <summary>Who is calling, after the token was verified and the account's roles were read from the database.</summary>
public sealed record ToloPrincipal
{
    public required Guid UserId { get; init; }
    public IReadOnlySet<string> Roles { get; init; } = new HashSet<string>();

    /// <summary>Admin page keys a staff account may reach (profiles.permissions). Admin tiers reach every page regardless.</summary>
    public IReadOnlySet<string> Pages { get; init; } = new HashSet<string>();

    /// <summary>Merchants this account owns or works for.</summary>
    public IReadOnlySet<Guid> MerchantIds { get; init; } = new HashSet<Guid>();

    public bool Is(string role) => Roles.Contains(role);

    public bool IsAdmin => Is(Identity.Roles.Admin) || Is(Identity.Roles.SuperAdmin);

    public bool IsMerchantMember => Is(Identity.Roles.MerchantOwner) || Is(Identity.Roles.MerchantStaff);

    /// <summary>The C# twin of has_admin_page(p_keys): an admin tier, or a staff account holding at least one of the keys.</summary>
    public bool HasAdminPage(params string[] keys) => IsAdmin || (Is(Identity.Roles.Staff) && keys.Any(Pages.Contains));

    public bool IsMemberOf(Guid merchantId) => MerchantIds.Contains(merchantId);
}
