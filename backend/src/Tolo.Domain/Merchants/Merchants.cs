using System.Text.Json.Serialization;
using Tolo.Domain.Common;
using Tolo.Domain.Identity;

namespace Tolo.Domain.Merchants;

/// <summary>The Postgres enum merchant_status (0002).</summary>
public enum MerchantStatus
{
    Registered,
    PendingVerification,
    UnderReview,
    Approved,
    Active,
    Suspended,
    Rejected,
    Closed,
}

public sealed record StoreInfo(
    [property: JsonPropertyName("name")] string Name,
    [property: JsonPropertyName("slug")] string Slug,
    [property: JsonPropertyName("logo_url")] string? LogoUrl,
    [property: JsonPropertyName("banner_url")] string? BannerUrl,
    [property: JsonPropertyName("description")] string? Description);

/// <summary>
/// What anyone may see of a merchant: the columns of the planned merchants_public view (id, name, category, place, created_at)
/// plus its storefront. By construction there is no phone, email, owner or registration number in this type, so no code path
/// can leak one through it.
/// </summary>
public sealed record PublicMerchant
{
    [JsonPropertyName("id")] public required Guid Id { get; init; }
    [JsonPropertyName("business_name")] public required string BusinessName { get; init; }
    [JsonPropertyName("category_id")] public Guid? CategoryId { get; init; }
    [JsonPropertyName("category_name")] public string? CategoryName { get; init; }
    [JsonPropertyName("location")] public string? Location { get; init; }
    [JsonPropertyName("city")] public string? City { get; init; }
    [JsonPropertyName("sub_city")] public string? SubCity { get; init; }
    [JsonPropertyName("woreda")] public string? Woreda { get; init; }
    [JsonPropertyName("landmark")] public string? Landmark { get; init; }
    [JsonPropertyName("latitude")] public decimal? Latitude { get; init; }
    [JsonPropertyName("longitude")] public decimal? Longitude { get; init; }
    [JsonPropertyName("created_at")] public DateTimeOffset CreatedAt { get; init; }
    [JsonPropertyName("store")] public StoreInfo? Store { get; init; }
}

/// <summary>A merchant as its own team and the admins see it in a list: public fields plus status. Still no contact details.</summary>
public sealed record ManagedMerchantSummary
{
    [JsonPropertyName("id")] public required Guid Id { get; init; }
    [JsonPropertyName("owner_id")] public Guid OwnerId { get; init; }
    [JsonPropertyName("business_name")] public required string BusinessName { get; init; }
    [JsonPropertyName("category_id")] public Guid? CategoryId { get; init; }
    [JsonPropertyName("category_name")] public string? CategoryName { get; init; }
    [JsonPropertyName("status")] public MerchantStatus Status { get; init; }
    [JsonPropertyName("is_test")] public bool IsTest { get; init; }
    [JsonPropertyName("location")] public string? Location { get; init; }
    [JsonPropertyName("city")] public string? City { get; init; }
    [JsonPropertyName("created_at")] public DateTimeOffset CreatedAt { get; init; }
}

/// <summary>Contact and registration details. Only ever produced for the merchant's own team and for admins or staff holding the Merchants page.</summary>
public sealed record MerchantContact(
    [property: JsonPropertyName("phone")] string? Phone,
    [property: JsonPropertyName("email")] string? Email,
    [property: JsonPropertyName("owner_full_name")] string? OwnerFullName,
    [property: JsonPropertyName("owner_phone")] string? OwnerPhone,
    [property: JsonPropertyName("owner_email")] string? OwnerEmail,
    [property: JsonPropertyName("business_registration_number")] string? BusinessRegistrationNumber);

public sealed record ManagedMerchant
{
    [JsonPropertyName("merchant")] public required ManagedMerchantSummary Merchant { get; init; }
    [JsonPropertyName("store")] public StoreInfo? Store { get; init; }
    [JsonPropertyName("contact")] public required MerchantContact Contact { get; init; }
    [JsonPropertyName("rejection_reason")] public string? RejectionReason { get; init; }
    [JsonPropertyName("suspension_reason")] public string? SuspensionReason { get; init; }
}

public sealed record MerchantQuery(string? Q = null, Guid? CategoryId = null, string? City = null, MerchantStatus? Status = null, string? Sort = null);

public interface IMerchantReader
{
    /// <summary>Active, non-test merchants only.</summary>
    Task<Page<PublicMerchant>> ListPublicAsync(MerchantQuery query, PageRequest page, CancellationToken ct = default);

    Task<PublicMerchant?> GetPublicAsync(Guid id, CancellationToken ct = default);

    /// <summary>Every status. <paramref name="onlyIds"/> limits the result to those merchants (null = no limit).</summary>
    Task<Page<ManagedMerchantSummary>> ListManagedAsync(MerchantQuery query, PageRequest page, IReadOnlyCollection<Guid>? onlyIds, CancellationToken ct = default);

    Task<ManagedMerchant?> GetManagedAsync(Guid id, CancellationToken ct = default);
}

/// <summary>Merchant reads for all three audiences. Data access is shared; this class is the one place that decides who gets which shape.</summary>
public sealed class MerchantModule(IMerchantReader reader)
{
    public const string AdminPage = "merchants";

    public Task<Page<PublicMerchant>> ListForCustomerAsync(MerchantQuery q, PageRequest p, CancellationToken ct = default) =>
        reader.ListPublicAsync(q with { Status = null }, p, ct);

    public Task<PublicMerchant?> GetForCustomerAsync(Guid id, CancellationToken ct = default) => reader.GetPublicAsync(id, ct);

    public Task<Page<ManagedMerchantSummary>> ListForMerchantAsync(ToloPrincipal who, MerchantQuery q, PageRequest p, CancellationToken ct = default) =>
        reader.ListManagedAsync(q, p, who.MerchantIds.ToArray(), ct);

    /// <summary>Null (a 404) both when the merchant does not exist and when the caller is not on its team, so existence is not revealed.</summary>
    public async Task<ManagedMerchant?> GetForMerchantAsync(ToloPrincipal who, Guid id, CancellationToken ct = default) =>
        who.IsMemberOf(id) ? await reader.GetManagedAsync(id, ct) : null;

    public Task<Page<ManagedMerchantSummary>> ListForAdminAsync(ToloPrincipal who, MerchantQuery q, PageRequest p, CancellationToken ct = default)
    {
        RequireMerchantsPage(who);
        return reader.ListManagedAsync(q, p, null, ct);
    }

    public Task<ManagedMerchant?> GetForAdminAsync(ToloPrincipal who, Guid id, CancellationToken ct = default)
    {
        RequireMerchantsPage(who);
        return reader.GetManagedAsync(id, ct);
    }

    private static void RequireMerchantsPage(ToloPrincipal who)
    {
        if (!who.HasAdminPage(AdminPage)) throw new ForbiddenException("The Merchants page is required.");
    }
}
