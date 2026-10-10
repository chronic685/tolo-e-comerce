namespace Tolo.Domain.Identity;

/// <summary>What a verified token says about its subject. Nothing here is trusted until the token's signature, issuer and audience have been checked.</summary>
public sealed record TokenIdentity(string Subject, string? Phone);

/// <summary>
/// Verifies a bearer token. Implementations: a JWT validator configured from the environment (an ASSUMPTION about Tolo's tokens
/// until their developer confirms, see docs/backend/tolo-schema-questions.md) and a local issuer for tests and development.
/// Returns null for anything that does not verify; never throws for a bad token.
/// </summary>
public interface IIdentityProvider
{
    Task<TokenIdentity?> ValidateAsync(string token, CancellationToken ct = default);
}

/// <summary>Maps a verified identity to a marketplace account and reads that account's roles.</summary>
public interface IPrincipalResolver
{
    /// <summary>Null when the identity maps to no active account.</summary>
    Task<ToloPrincipal?> ResolveAsync(TokenIdentity identity, CancellationToken ct = default);
}

/// <summary>Reads an account's roles from the database. Separate from the mapping so each can be replaced on its own.</summary>
public interface IAccountDirectory
{
    Task<ToloPrincipal?> LoadAsync(Guid userId, CancellationToken ct = default);
}
