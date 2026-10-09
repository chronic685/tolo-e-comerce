# Tolo C# backend

Strangler-style replacement for the Edge Functions, one phase at a time. Design and phases: `docs/backend/adr-0001-csharp-backend.md`.
Gaps against the integration docs: `docs/backend/contract-notes.md`.

| Project | What |
|---|---|
| `src/Tolo.Domain` | Contracts (documented JSON shapes), rules, interfaces. No I/O |
| `src/Tolo.Infrastructure` | EF Core + Npgsql (DB-first, no migrations), marketplace HTTP client, in-memory fakes |
| `src/Tolo.Api` | Minimal API: `/health`, `/health/ready`, `/openapi/v1.json`, `/integrations/tolo-marketplace/*`, `/app/me/*` |
| `src/Tolo.Worker` | Scheduled jobs (sample heartbeat job only) |
| `tests/Tolo.Tests` | xUnit: contract, platform, domain, optional local-DB tests |

## Rules

- The schema is owned by `supabase/migrations`. Do not add EF migrations or call `Migrate`/`EnsureCreated`.
- Configuration is environment variables only (`.env.example`). No secrets in the repo.
- Never point a dev machine or test at the live database. DB tests refuse non-local hosts.

## Commands (from `backend/`)

```
dotnet build Tolo.slnx
dotnet test Tolo.slnx                      # DB tests are skipped unless TOLO_TEST_DATABASE_URL is set
dotnet format Tolo.slnx --verify-no-changes
docker compose up --build                  # api on http://localhost:8080 with a local Postgres
docker compose up -d db && TOLO_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:54329/postgres dotnet test Tolo.slnx
```

The database tests reset the `public` schema of the database they are given, which is why they accept local hosts only.
