namespace Tolo.Worker;

/// <summary>A job that runs on a fixed interval. Jobs must be idempotent: a crash mid-run means it runs again.</summary>
public interface IScheduledJob
{
    string Name { get; }

    TimeSpan Interval { get; }

    Task RunAsync(CancellationToken ct);
}

/// <summary>Sample job: proves the worker is alive and scheduling. Does nothing else.</summary>
public sealed partial class HeartbeatJob(ILogger<HeartbeatJob> logger) : IScheduledJob
{
    public string Name => "heartbeat";

    public TimeSpan Interval { get; } = TimeSpan.FromMinutes(1);

    public Task RunAsync(CancellationToken ct)
    {
        LogBeat(logger);
        return Task.CompletedTask;
    }

    [LoggerMessage(Level = LogLevel.Information, Message = "worker heartbeat")]
    private static partial void LogBeat(ILogger logger);
}

/// <summary>Runs every registered job on its own interval. One job failing is logged and never stops the others.</summary>
public sealed partial class JobScheduler(IEnumerable<IScheduledJob> jobs, ILogger<JobScheduler> logger) : BackgroundService
{
    protected override Task ExecuteAsync(CancellationToken stoppingToken) =>
        Task.WhenAll(jobs.Select(job => LoopAsync(job, stoppingToken)));

    private async Task LoopAsync(IScheduledJob job, CancellationToken ct)
    {
        using var timer = new PeriodicTimer(job.Interval);
        do
        {
            await RunOnceAsync(job, ct);
        }
        while (await WaitAsync(timer, ct));
    }

    /// <summary>Runs a job once, swallowing and logging its failure. Exposed for tests.</summary>
    public async Task RunOnceAsync(IScheduledJob job, CancellationToken ct)
    {
        try
        {
            await job.RunAsync(ct);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            LogJobFailed(logger, ex, job.Name);
        }
    }

    private static async Task<bool> WaitAsync(PeriodicTimer timer, CancellationToken ct)
    {
        try
        {
            return await timer.WaitForNextTickAsync(ct);
        }
        catch (OperationCanceledException)
        {
            return false;
        }
    }

    [LoggerMessage(Level = LogLevel.Error, Message = "scheduled job {JobName} failed")]
    private static partial void LogJobFailed(ILogger logger, Exception ex, string jobName);
}
