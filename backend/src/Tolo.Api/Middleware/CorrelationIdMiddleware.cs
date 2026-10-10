using System.Diagnostics;
using System.Text.RegularExpressions;

namespace Tolo.Api.Middleware;

/// <summary>
/// Gives every request a correlation id: the caller's X-Correlation-Id when it is a short safe token, otherwise a new one.
/// It is echoed on the response and attached to every log line of the request. Logs carry method, path and status only:
/// never a body, a query string, a header or a code.
/// </summary>
public sealed partial class CorrelationIdMiddleware(RequestDelegate next, ILogger<CorrelationIdMiddleware> logger)
{
    public const string HeaderName = "X-Correlation-Id";

    [GeneratedRegex("^[A-Za-z0-9._-]{1,64}$")]
    private static partial Regex Safe();

    public async Task InvokeAsync(HttpContext context)
    {
        var supplied = context.Request.Headers[HeaderName].ToString();
        var id = Safe().IsMatch(supplied) ? supplied : Guid.NewGuid().ToString("N");
        context.Items[HeaderName] = id;
        context.Response.OnStarting(() =>
        {
            context.Response.Headers[HeaderName] = id;
            return Task.CompletedTask;
        });

        using var scope = logger.BeginScope(new Dictionary<string, object> { ["CorrelationId"] = id });
        var clock = Stopwatch.StartNew();
        try
        {
            await next(context);
        }
        finally
        {
            LogRequest(logger, context.Request.Method, context.Request.Path.Value, context.Response.StatusCode, clock.ElapsedMilliseconds);
        }
    }

    [LoggerMessage(Level = LogLevel.Information, Message = "{Method} {Path} -> {Status} in {ElapsedMs} ms")]
    private static partial void LogRequest(ILogger logger, string method, string? path, int status, long elapsedMs);
}
