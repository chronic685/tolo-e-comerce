# Running the C# backend

Code lives in `backend/` (see `backend/README.md` for the project layout). Design and hosting: `adr-0001-csharp-backend.md`.
Questions for Tolo's developer: `tolo-schema-questions.md`.

## Run it locally

You need the .NET 10 SDK, and Docker if you want the compose stack.

```
cd backend
cp .env.example .env            # then fill in throwaway values; .env is git-ignored
docker compose up --build       # api on http://localhost:8080, a local Postgres on localhost:54329
```

Without Docker: `dotnet run --project src/Tolo.Api` with the variables below exported in your shell. With no `DATABASE_URL`
the API starts, `/health` answers, and every data route answers 503 on purpose.

Useful URLs: `/health`, `/health/ready`, `/openapi/v1.json`. For a development token set `ASPNETCORE_ENVIRONMENT=Development`,
`TOLO_ENABLE_DEV_TOKENS=true` and the `TOLO_JWT_*` values, then `POST /dev/token?sub=<profile uuid>`.

## Run the tests

```
cd backend
dotnet format Tolo.slnx --verify-no-changes
dotnet build Tolo.slnx
dotnet test Tolo.slnx          # database tests are skipped unless TOLO_TEST_DATABASE_URL is set
```

To include the database tests, point `TOLO_TEST_DATABASE_URL` at a **local** Postgres (for example the compose one):

```
docker compose up -d db
TOLO_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:54329/postgres dotnet test Tolo.slnx
```

They create a database called `tolo_test_*` on that server, apply `tests/Tolo.Tests/Database/supabase_stubs.sql` (the Supabase-only
pieces) and then every file in `supabase/migrations`, and drop it when the run ends. Any host other than localhost, 127.0.0.1,
`db` or `postgres` is refused. The live project is never involved.

The repo's JS tests are separate: the Supabase-backed ones need a local Supabase too (`tests/README.md`).

## Environment variables

All configuration is environment variables; `backend/.env.example` has the same list with no values.

| Variable | Purpose | Default |
|---|---|---|
| `DATABASE_URL` | Postgres URI or Npgsql connection string for the marketplace database. Unset: data routes answer 503 | unset |
| `TOLO_JWT_ISSUER` | Expected token issuer. Required for tokens to verify | unset (all tokens rejected) |
| `TOLO_JWT_AUDIENCE` | Expected token audience. Required | unset |
| `TOLO_JWT_SIGNING_KEY` | HS256 shared secret, used as UTF-8 bytes | unset |
| `TOLO_JWT_JWKS_URL` | JWKS URL for RS256/ES256 tokens (use this and/or the signing key) | unset |
| `TOLO_BACKEND_SHARED_KEY` | Bearer for `/internal/*` (Tolo's server-to-server calls). Unset: every `/internal` call is 503 | unset |
| `TOLO_RATE_LIMIT_PER_MINUTE` | Requests per source IP per minute (health excluded) | `120` |
| `TOLO_TRUST_FORWARDED_HEADERS` | Honor `X-Forwarded-For`. Only `true` behind a proxy that overwrites it | `false` |
| `TOLO_ENABLE_DEV_TOKENS` | Expose `POST /dev/token`. Development environment only; the app refuses to start otherwise | `false` |
| `ASPNETCORE_ENVIRONMENT` | Standard ASP.NET environment name | `Production` |
| `TOLO_TEST_DATABASE_URL` | Tests only: a local Postgres for the database tests | unset (those tests skip) |

## CI

`.github/workflows/backend.yml` runs on changes to `backend/**`, `supabase/migrations/**` and the workflow itself: format check, build,
tests (with a throwaway Postgres service container), and a second job that builds the API and worker Docker images (no push) and
validates `docker-compose.yml`. The JS pipeline in `ci.yml` is separate.
