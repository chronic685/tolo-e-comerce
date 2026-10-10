using Tolo.Domain.Catalog;
using Tolo.Domain.Common;
using Tolo.Domain.Merchants;

namespace Tolo.Infrastructure.Fakes;

/// <summary>Registered when DATABASE_URL is not set: every read fails with a 503 instead of returning an empty list that looks real.</summary>
public sealed class UnavailableReader : IMerchantReader, ICatalogReader
{
    private static DatabaseNotConfiguredException Fail() => new();

    public Task<IReadOnlyList<Category>> ListCategoriesAsync(bool includeInactive, CancellationToken ct = default) => throw Fail();

    public Task<Page<ProductSummary>> ListPublicProductsAsync(ProductQuery query, PageRequest page, CancellationToken ct = default) => throw Fail();

    public Task<PublicProduct?> GetPublicProductAsync(Guid id, CancellationToken ct = default) => throw Fail();

    public Task<Page<ManagedProductSummary>> ListManagedProductsAsync(ProductQuery query, PageRequest page, IReadOnlyCollection<Guid>? onlyMerchantIds, CancellationToken ct = default) => throw Fail();

    public Task<ManagedProduct?> GetManagedProductAsync(Guid id, CancellationToken ct = default) => throw Fail();

    public Task<Page<PublicMerchant>> ListPublicAsync(MerchantQuery query, PageRequest page, CancellationToken ct = default) => throw Fail();

    public Task<PublicMerchant?> GetPublicAsync(Guid id, CancellationToken ct = default) => throw Fail();

    public Task<Page<ManagedMerchantSummary>> ListManagedAsync(MerchantQuery query, PageRequest page, IReadOnlyCollection<Guid>? onlyIds, CancellationToken ct = default) => throw Fail();

    public Task<ManagedMerchant?> GetManagedAsync(Guid id, CancellationToken ct = default) => throw Fail();
}
