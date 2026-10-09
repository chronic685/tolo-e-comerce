# ADR 0001: A C# backend for the marketplace, one module at a time

Status: proposed (foundation and the first read-only modules built on `feat/csharp-backend-foundation`; nothing deployed)
Date: 2026-10-09

## Context

The marketplace's API layer today is Supabase: PostgREST over Postgres with RLS, plus Deno Edge Functions
(`supabase/functions`). Tolo's CTO direction is to have our own backend, written from scratch, with these constraints:

- **The SQL database stays exactly as it is.** `supabase/migrations` is the single source of truth. No schema change comes
  with this work.
- **Anything about Tolo's own data (customers, merchants, drivers) must match Tolo's MongoDB.** Their developer will send
  the schema; until then nothing may guess it.
- Three audiences use the data: customers (the storefront), merchants (the merchant dashboard) and admins/staff (the admin
  dashboard).

## Decision

### 1. Modular monolith, one deployable

One .NET 10 (LTS) solution, one Docker image, one deployment, one CI job.

| Project | Role |
|---|---|
| `Tolo.Api` | HTTP, minimal APIs. Three route areas, one authorization policy each |
| `Tolo.Domain` | Modules (merchants, catalog, identity), contracts, rules, interfaces. No I/O |
| `Tolo.Infrastructure` | EF Core + Npgsql (DB-first, migrations disabled), JWT validation, fakes for Tolo data |
| `Tolo.Worker` | Background service skeleton with one sample job |
| `Tolo.Tests` | xUnit |

The areas `/api/customer`, `/api/merchant` and `/api/admin` call the **same** domain modules. A module owns its rules and
decides which shape each audience gets; the route layer only chooses who may call. No business rule is written twice.
Planned modules: catalog, merchants, orders, payouts, returns, notifications, identity. Built so far: identity, merchants
and catalog (read-only).

### 2. Strangler migration

Each frontend keeps using Supabase until its module is switched over. A module moves when its C# endpoints have the tests
the Supabase path implicitly relies on (authorization, visibility, pagination), and a frontend switches by changing the
module's data source, one screen or route at a time. The Edge Functions are deleted only after a release in which the C#
version served live traffic without incident. Because Supabase-issued tokens are accepted (below), a signed-in user keeps
their session across the switch.

### 3. Postgres stays, EF Core is DB-first

EF Core maps existing tables and only the columns it reads. There are no EF migrations; nothing calls `Migrate` or
`EnsureCreated`, and a test asserts it. Private merchant columns (phone, email, owner, registration number) are not part of
the EF model at all: one explicit query reads them for the roles allowed to see them, so a public query cannot select them
by accident.

### 4. Safe-column rule

What a customer or anonymous visitor may see of a merchant is exactly the columns of the planned `merchants_public` view
(PR #27, migration 0099) plus its storefront: id, name, category, place, created date. The type that carries it
(`PublicMerchant`) has no contact members, so no code path can leak one through it. Contact details and the registration
number exist only on `ManagedMerchant`, produced for the merchant's own team and for admins/staff holding the Merchants
page. Public lists show only `active`, non-test merchants and `published` products of such merchants. Tests assert the
absence of both the values and the JSON keys in every customer-visible response.

When PR #27's contract migration (`merchant_private`) lands, only the one contact query changes.

### 5. Identity and roles

`IIdentityProvider` verifies a bearer token; `IPrincipalResolver` maps it to an account; `IAccountDirectory` loads the
account's roles **from the database**, never from the token.

- **JWT validator** (env: `TOLO_JWT_ISSUER`, `TOLO_JWT_AUDIENCE`, `TOLO_JWT_SIGNING_KEY` and/or `TOLO_JWT_JWKS_URL`). Rejects
  unsigned tokens, other algorithms than HS256/RS256/ES256, other issuers/audiences, and expired tokens. **Assumption-based**
  until Tolo's developer confirms their token format.
- **Local test issuer** (`DevTokenIssuer`) for tests, and for development behind `POST /dev/token`, which exists only when
  `TOLO_ENABLE_DEV_TOKENS=true` in the Development environment. The app refuses to start with it enabled elsewhere.
- **Mapping.** A uuid subject is the marketplace profile id (this is how Supabase-issued tokens work). Any other subject is a
  Tolo id: its verified phone (token claim, else the Tolo customer directory) is matched **only through `tolo_phone_links`**
  (migration 0072), never `profiles.phone`, and never to a staff or admin account.
- **Roles**, matching today's rules: `customer`, `merchant_owner`, `merchant_staff`, `staff` (per-page permissions, the C# twin
  of `has_admin_page()`), `admin`, `super_admin`. A suspended account has no roles. A merchant owner is also a customer;
  staff and admin accounts are not.
- **Area policies.** Customer area: anonymous browsing, or a signed-in customer (a request that sends a token must send a valid
  one; staff and admins are refused). Merchant area: owners and merchant staff, restricted to their own merchants. Admin area:
  staff and admin tiers, with the page check inside the module. Tests prove each area rejects the other audiences.

### 6. Tolo data boundary

Everything that depends on Tolo's data sits behind `IToloCustomerDirectory`, `IToloMerchantDirectory` and
`IToloDriverDirectory` (anti-corruption layer). Ids are opaque strings, members are named for what *we* need, and every
implementation today is a fake. A Tolo id that would need a column uses the mapping that already exists
(`tolo_phone_links`) or stays in the fake layer. Proposed extra columns, once the Mongo schema is known, are listed in
`tolo-schema-questions.md` as proposals only. No migration is added.

### 7. Operational baseline

Environment-only configuration (`backend/.env.example`), structured JSON logs, correlation ids, per-IP rate limiting,
constant-time shared-key middleware on `/internal` (for Tolo's server-to-server calls), OpenAPI at `/openapi/v1.json`,
liveness and readiness endpoints. Tests run only against a **local** Postgres: they create a throwaway database, load the
Supabase stubs and every file of `supabase/migrations`, and refuse any non-local host.

## Phases

| Phase | Scope | State |
|---|---|---|
| 0 | Foundation: solution, health, logging, OpenAPI, rate limiting, shared-key auth, correlation ids, Docker, CI | built |
| 1 | Identity (JWT + roles + area policies), Tolo data boundary with fakes, read-only merchants and catalog | built |
| 2 | Customer reads the storefront needs end to end (cart reads, reviews, favourites, banners, order history reads) | next |
| 3 | Merchant and admin reads (orders, inventory, finance reports); frontends start switching screen by screen | planned |
| 4 | Writes, module by module, each with the existing SQL rules re-checked: merchant products, order status flow, returns | planned |
| 5 | Checkout, payments, settlements, payouts, notifications; retire the matching Edge Functions | planned |
| 6 | Tolo integrations once their schema and API exist: login handoff, driver dispatch, merchant master data | blocked on Tolo |

Phases 4 and 5 touch money and live orders: each needs its own backup, rollout and rollback plan, and the writes keep the
database triggers as the last line of defence.

## Hosting

Requirement: the API serves live order traffic, so it must be **always on**. **Free tiers that sleep are unsuitable for live
order traffic**: a spun-down service takes about a minute to wake, which means failed requests at the worst moments.

Limits below were read from each provider's pages on 2026-10-09 and change often; check before committing.

| Host | Free tier | Always on? | Notes |
|---|---|---|---|
| **Azure Container Apps** (Consumption) | Monthly free grant of 180,000 vCPU-seconds, 360,000 GiB-seconds and 2 million requests | Yes with `minReplicas: 1` (scale-to-zero optional) | Idle replicas are billed at a reduced rate. One small replica (0.25 vCPU / 0.5 GiB) that is mostly idle should land at or near the free grant (estimate, not a quote). Native Docker and .NET support |
| **Fly.io** | None for new organizations, only a trial of 2 hours or 7 days | Yes | Cheapest always-on machine (shared-cpu-1x, 256 MB) is $2.19 a month plus egress. 256 MB is tight for ASP.NET, so plan on 512 MB |
| **Render** | Free web service: 750 instance hours a month | **No.** Spins down after 15 minutes idle, about a minute to restart | Fine for demos and previews, not for live traffic. Paid instances are always on |
| **Google Cloud Run** | Monthly free quota of requests and vCPU/memory seconds (exact figures not confirmed here) | Only with min-instances 1, and idle time is then billed | A good fit, similar to Azure |

**Recommendation:** Azure Container Apps on the Consumption plan with `minReplicas: 1` for the API (the worker as a second
container app). It has a real free grant, no sleep, first-class .NET and Docker support, and scale-out later without moving.
Fall back to Fly.io (about $2 to $5 a month) if Azure account setup is a problem. Use Render's free tier only for non-production
previews. The database does not move: Postgres stays on Supabase, reached through its connection pooler.

## Consequences

- Two runtimes (Deno and .NET) coexist for a while; the payoff is moving one module at a time.
- A few rules are duplicated in C# (phone normalization, key comparison, `has_admin_page`). Tests mirror the SQL and
  edge-function behaviour so drift is caught.
- The backend CI job runs on `backend/` changes only, as asked. Its database tests load the migrations as they are on the
  branch, so a migration-only PR does not re-run them; run the workflow manually (`workflow_dispatch`) when migrations change.
- Nothing is deployed and no secrets are set by this change.
