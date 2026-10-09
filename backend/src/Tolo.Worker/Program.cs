using Tolo.Worker;

var builder = Host.CreateApplicationBuilder(args);

builder.Logging.ClearProviders();
builder.Logging.AddJsonConsole(o => o.IncludeScopes = true);

builder.Services.AddSingleton(TimeProvider.System);
// Register scheduled jobs here. The skeleton ships one sample job; real jobs (code cleanup, delivery retries) come with later phases.
builder.Services.AddSingleton<IScheduledJob, HeartbeatJob>();
builder.Services.AddHostedService<JobScheduler>();

await builder.Build().RunAsync();
