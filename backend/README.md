# Tolo C# backend

One codebase, one image, one deployment: the API layer that will gradually take over from Supabase's PostgREST and Edge
Functions. Design, phases and hosting: `docs/backend/adr-0001-csharp-backend.md`. Questions for Tolo's developer:
`docs/backend/tolo-schema-questions.md`.

| Project | What |
|---|---|
| `src/Tolo.Api` | Minimal APIs: `/api/customer`, `/api/merchant`, `/api/admin` (one authorization policy each), `/health`, `/health/ready`, `/openapi/v1.json`, `/internal/*` (shared key) |
| `src/Tolo.Domain` | Modules (identity, merchants, catalog), contracts, rules, interfaces. No I/O |
| `src/Tolo.Infrastructure` | EF Core + Npgsql (DB-first, no migrations), JWT validation, fakes for Tolo's data |
| `src/Tolo.Worker` | Scheduled jobs (sample heartbeat job only) |
| `tests/Tolo.Tests` | xUnit: area isolation, identity, safe columns, pagination, platform, optional local-DB tests |

## Rules

- The schema is owned by `supabase/migrations`. Do not add EF migrations or call `Migrate`/`EnsureCreated`.
- Configuration is environment variables only (`.env.example`). No secrets in the repo.
- Never point a dev machine or test at the live database. DB tests refuse non-local hosts and create their own throwaway database.
- Tolo's data goes behind `ITolo*Directory`; never guess its field names.

## Commands (from `backend/`)

```
dotnet build Tolo.slnx
dotnet test Tolo.slnx                      # DB tests are skipped unless TOLO_TEST_DATABASE_URL is set
dotnet format Tolo.slnx --verify-no-changes
docker compose up --build                  # api on http://localhost:8080 with a local Postgres
docker compose up -d db && TOLO_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:54329/postgres dotnet test Tolo.slnx
```

The database tests create a database named `tolo_test_*` on the server you point them at (local only), apply a small stub of the
Supabase-only pieces (`tests/Tolo.Tests/Database/supabase_stubs.sql`) and then every migration in order, and drop it when the
run ends.

## Local development

Set `ASPNETCORE_ENVIRONMENT=Development`, `TOLO_ENABLE_DEV_TOKENS=true` and the `TOLO_JWT_*` values in `.env`, then
`POST /dev/token?sub=<profile uuid>` returns a token for that profile. Roles always come from the database.
