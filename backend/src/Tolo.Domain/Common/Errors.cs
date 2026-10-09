namespace Tolo.Domain.Common;

/// <summary>The caller is known but may not do this (HTTP 403).</summary>
public sealed class ForbiddenException(string message = "Forbidden.") : Exception(message);

/// <summary>DATABASE_URL is not set, so data routes cannot answer (HTTP 503).</summary>
public sealed class DatabaseNotConfiguredException() : Exception("The database is not configured.");
