namespace Tolo.Tests.Support;

public sealed class TestTime : TimeProvider
{
    private DateTimeOffset _now = new(2026, 10, 1, 9, 0, 0, TimeSpan.Zero);

    public override DateTimeOffset GetUtcNow() => _now;

    public void Advance(TimeSpan by) => _now += by;
}
