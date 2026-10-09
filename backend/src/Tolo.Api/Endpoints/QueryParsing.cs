using System.Globalization;
using Tolo.Domain.Catalog;
using Tolo.Domain.Common;
using Tolo.Domain.Merchants;

namespace Tolo.Api.Endpoints;

/// <summary>Reads list filters from the query string. A malformed value is a 400 naming the parameter, never a silent default.</summary>
internal sealed class QueryParsing(IQueryCollection query)
{
    private readonly List<string> _errors = [];

    public IReadOnlyList<string> Errors => _errors;

    public string? Text(string name) => query[name].ToString() is { Length: > 0 } s ? s : null;

    public Guid? Guid(string name) => Parse(name, (string s, out Guid v) => System.Guid.TryParse(s, out v));

    public decimal? Decimal(string name) =>
        Parse(name, (string s, out decimal v) => decimal.TryParse(s, NumberStyles.Number, CultureInfo.InvariantCulture, out v) && v >= 0);

    public bool? Bool(string name) => Parse(name, (string s, out bool v) => bool.TryParse(s, out v));

    public int Int(string name, int fallback) => Parse(name, (string s, out int v) => int.TryParse(s, NumberStyles.Integer, CultureInfo.InvariantCulture, out v)) ?? fallback;

    /// <summary>snake_case or PascalCase enum names, case-insensitive: pending_verification, published.</summary>
    public T? Enum<T>(string name) where T : struct, Enum =>
        Parse(name, (string s, out T v) => System.Enum.TryParse(s.Replace("_", "", StringComparison.Ordinal), true, out v) && System.Enum.IsDefined(v));

    private delegate bool TryParser<T>(string s, out T value);

    private T? Parse<T>(string name, TryParser<T> parser) where T : struct
    {
        var raw = Text(name);
        if (raw is null) return null;
        if (parser(raw, out var value)) return value;
        _errors.Add($"{name} is not valid");
        return null;
    }

    public PageRequest Page() => new PageRequest(Int("page", 1), Int("page_size", PageRequest.DefaultSize)).Normalized();

    public MerchantQuery Merchants() => new(Text("q"), Guid("category_id"), Text("city"), Enum<MerchantStatus>("status"), Text("sort"));

    public ProductQuery Products() => new(Text("q"), Guid("merchant_id"), Guid("category_id"), Decimal("min_price"), Decimal("max_price"), Bool("featured"), Enum<ProductStatus>("status"), Text("sort"));
}
