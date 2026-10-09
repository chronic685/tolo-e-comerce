# ADR 0001: Replace the backend with C#, one strangler step at a time

Status: proposed (Phase 0 and Phase 1 built on `feat/csharp-backend-foundation`, nothing deployed)
Date: 2026-10-09

## Context

The marketplace backend today is Postgres on Supabase (schema, RLS, SQL functions) plus Deno Edge Functions
(`supabase/functions`). Pieces of the Tolo integration already assume a *Tolo-side backend* that does not exist
(`docs/integration/tolo-app.md`, `docs/integration/delivery-handoff.md`). We want a C# backend, but a rewrite in one
go would put live order traffic at risk.

## Decision

1. **Strangler architecture.** The C# backend (`backend/`) grows next to the Edge Functions. Each capability moves
   only when the C# version passes the same contract tests as the one it replaces, and callers switch by changing a
   URL or a secret, not code. Edge Functions are deleted only after a release with the C# version live and quiet.
2. **Postgres stays the database.** `supabase/migrations` stays the single source of truth for the schema.
   EF Core is used DB-first: it maps existing tables, has no migrations, and never calls `Migrate` or `EnsureCreated`
   (a test asserts there are none). Schema changes remain SQL migration files applied by the existing process
   (guidelines rules 13 and 14).
3. **Shape.** `Tolo.Domain` (rules, contracts, interfaces, no I/O), `Tolo.Infrastructure` (EF Core + Npgsql, marketplace
   HTTP client, in-memory fakes), `Tolo.Api` (minimal APIs), `Tolo.Worker` (scheduled jobs), `Tolo.Tests` (xUnit).
   .NET 10 LTS.
4. **Configuration only through environment variables**, documented in `backend/.env.example` without values.
5. **Tests never touch the live database.** Unit and contract tests are in-memory. Database tests need
   `TOLO_TEST_DATABASE_URL` and refuse any non-local host; CI uses a throwaway Postgres service container.

## Phases

| Phase | Scope | State |
|---|---|---|
| 0 | Foundation: solution, health, logging, OpenAPI, rate limiting, shared-key auth, correlation ids, Docker, CI | built |
| 1 | The Tolo-app side of the integration: login-code verify, merchant-application status client, delivery-job receiver, `tolo_phone_links` rules. Tolo-owned data behind fakes | built (fakes pending real Tolo data) |
| 2 | Port `tolo-app-login` / `tolo-merchant-login` / `merchant-application-status` from Edge Functions (reuse `PhoneLinkService`) | not started |
| 3 | Port delivery handoff and `delivery-status-callback`, order status transitions | not started |
| 4 | Read-heavy marketplace APIs (catalog, orders) behind the API, frontends switch per route | not started |
| 5 | Checkout, payments, settlement; retire Edge Functions | not started |

Phases 3 to 5 touch money and live orders, so each needs its own backup, rollout and rollback plan.

## Hosting

The deciding requirement: **the API receives delivery jobs and login codes in real time, so it must be always on.**
A host that sleeps when idle is unsuitable for live order traffic: a spun-down free service takes about a minute to
wake, and the marketplace's job POST times out after 10 seconds, leaving the job unacknowledged until a manual retry.

Limits below were read from each provider's pricing pages on 2026-10-09 and change often; check before committing.

| Host | Free tier | Always on? | Notes |
|---|---|---|---|
| **Azure Container Apps** (Consumption) | Monthly free grant of 180,000 vCPU-seconds, 360,000 GiB-seconds and 2 million requests | Yes, with `minReplicas: 1`. Scale-to-zero is optional | Idle replicas are billed at a reduced rate. A single small replica (0.25 vCPU / 0.5 GiB) mostly idle should land at or near the free grant (estimate, not a quote). Native .NET and Docker support |
| **Fly.io** | None for new organizations: a trial of 2 hours or 7 days | Yes | Cheapest always-on machine (shared-cpu-1x, 256 MB) is $2.19 a month plus egress. 256 MB is tight for ASP.NET, so plan on 512 MB |
| **Render** | Free web service: 750 instance hours a month | **No.** Spins down after 15 minutes idle, about 1 minute to restart | Fine for demos and CI previews, not for live traffic. Paid instances are always on |
| **Google Cloud Run** | Monthly free quota of requests and vCPU/memory seconds (exact numbers not confirmed here) | Only with min-instances 1, and idle time is then billed | Good fit, similar to Azure |

### Recommendation

Run the API on **Azure Container Apps (Consumption plan, `minReplicas: 1`)**, with the worker as a second container
app (or a scheduled job). It has a real free grant, no sleep, first-class .NET tooling, and scale-out later without a
move. Fall back to **Fly.io** (about $2 to $5 a month, no free tier) if Azure account setup is a problem. Use Render's
free tier only for non-production previews. Whatever is chosen, put the URL in the marketplace's `TOLO_BACKEND_URL`
only after the real Tolo data is connected (see `contract-notes.md`).

The database does not move: Postgres stays on Supabase, reached through its connection pooler.

## Consequences

- Two runtimes (Deno and .NET) coexist for a while. The cost is paid back by being able to move one capability at a time.
- The C# service duplicates a few rules (phone normalization, constant-time key check). Tests mirror the edge-function
  tests so they cannot drift silently.
- Nothing is deployed and no secrets are set by this change. Connecting it to the marketplace is a separate, explicit step.
