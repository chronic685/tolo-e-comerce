using System.Text.Json.Serialization;

namespace Tolo.Domain.Common;

public sealed record PageRequest(int Page = 1, int PageSize = PageRequest.DefaultSize)
{
    public const int DefaultSize = 20;
    public const int MaxSize = 100;

    /// <summary>Clamps instead of failing: a page below 1 is 1, a size of 0 or less is the default, and a size above the maximum is the maximum.</summary>
    public PageRequest Normalized() => new(Math.Max(1, Page), PageSize <= 0 ? DefaultSize : Math.Min(PageSize, MaxSize));

    public int Skip => (Normalized().Page - 1) * Normalized().PageSize;
}

public sealed record Page<T>(
    [property: JsonPropertyName("items")] IReadOnlyList<T> Items,
    [property: JsonPropertyName("page")] int PageNumber,
    [property: JsonPropertyName("page_size")] int PageSize,
    [property: JsonPropertyName("total")] int Total);
