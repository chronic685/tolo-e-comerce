# Regression & security smoke tests

## Purpose

Two real bugs were found this session through manual `curl` testing, not automated tests:

1. **Payment spoofing** — `payment-webhook` was public/unauthenticated and its only "verification" was checking whether the request body said `{status:"success"}`. Anyone holding a `payment_id` could mark any order paid without paying.
2. **CORS preflight failure** — several edge functions ran their full handler (including the auth check) on the browser's `OPTIONS` preflight request instead of short-circuiting it, so the preflight got a `401` and the browser silently blocked the real request. This is why merchant "ORDER RECEIVED" kept failing.

While building this suite, the same authentication-bypass bug class was found a **third** time in `delivery-dispatch` (no auth check at all) and fixed the same way.

This suite exists to make that specific class of bug — missing auth, missing CORS handling, trusting client-supplied payment state — fail CI instead of waiting for a human to notice.

## What is and isn't covered

Run `npm test` from the repo root. Copy `tests/.env.test.example` to `tests/.env.test` and fill it in for local runs; CI uses repository secrets instead.

| Category | Status |
|---|---|
| Authentication (no/invalid/valid token) | ✅ `smoke/auth.test.ts` |
| Input validation | ✅ `smoke/input-validation.test.ts` |
| CORS preflight + real request | ✅ `smoke/cors.test.ts` |
| Merchant tenant isolation | ✅ `smoke/merchant-authorization.test.ts` (D1/D2/D3/D4 fully covered) |
| Payment anti-spoofing | ✅ `smoke/payment-spoofing.test.ts` |
| Webhook/confirmation idempotency | ✅ `smoke/payment-spoofing.test.ts` (reuses an existing verified demo payment) |
| Commission calculation | ✅ `unit/commission.test.ts` |
| Discount resolution | ✅ `unit/discount.test.ts` |
| Delivery fee calculation | ✅ `unit/delivery-fee.test.ts` |

### Known gaps (NOT COVERED, and why)

There is **no isolated test database** for this project — it is one live Supabase project, and Docker isn't available in this environment to run `supabase start` locally. Every test that touches a *shared* fixture either reads data or performs an action that must be *rejected* (so nothing changes); tests that need to exercise a real, successful, state-changing transition instead create their own disposable order via `create_order()` (the real checkout path, not a direct insert) and leave the shared fixtures untouched — see `smoke/merchant-authorization.test.ts`'s D1 test, or any of the Phase 5c/5d `createDisposableOrder` helpers, for the pattern. One happy-path still isn't exercised end-to-end for a different reason:

- **The `create_order()` discount clamp** (`least(amount, subtotal)`, preventing a discount larger than the order from producing a negative total) — verified by reading the source directly (see `unit/discount.test.ts`), not by creating a real order through checkout on every test run.

If that needs real regression coverage too, the honest next step is the same disposable-order pattern already used elsewhere in this suite (there is no delete path today — orders are intentionally append-only/audit-safe — so a disposable order is left in a terminal status, not removed).

### A minor finding, not fixed

`confirm-payment` checks `payment.status === "verified"` (returning `already_processed: true`) **before** checking the caller's role. This means any authenticated user can probe whether a given `payment_id` is already verified, without being the merchant or Tolo finance. It never performs an action and payment IDs are non-enumerable UUIDs, so this was judged low-severity and left as-is rather than reordering a working function for a negligible information leak — flagging it here in case that judgment call should be revisited.

## QA fixtures

`tests/fixtures/ensureQaFixtures.ts` runs once per `vitest run` (via `globalSetup`) and idempotently creates, if they don't already exist:

- Two merchants ("QA TEST — Merchant A/B — DO NOT USE") with one owner account each
- One QA customer account
- One QA staff account (promoted to `tolo_admin` — see below)
- One product/variant/inventory row under Merchant A
- One order (via `create_order()`) permanently left in `new` status, and its `pending` `cash_on_delivery` payment

Nothing here is deleted between runs — the fixtures are meant to be created once and reused, not recreated per run. They are clearly labeled so they're never mistaken for real data in the live admin dashboard.

**One manual, one-time step**: the QA staff account cannot be promoted to `tolo_admin` through the normal API — `profiles` has a self-escalation trigger that only `is_tolo_admin()` (an already-authenticated admin) can pass, and there is no bootstrap admin credential available to this suite. It was promoted once via a direct SQL admin query (`alter table ... disable trigger ...; update ...; alter table ... enable trigger ...;`), the same one-time pattern the project's own `0020_demo_admin.sql` migration used for the real demo admin account. If the QA staff account is ever lost/recreated, that step needs to be repeated manually (with explicit approval — it's a security-sensitive action, not something to automate quietly).

## Manual regression cases (curl)

These reproduce the two original bugs and confirm they stay fixed. Replace `$SUPABASE_URL` / `$ANON_KEY` with real values — never commit them.

### CORS preflight (the "ORDER RECEIVED" bug)

```bash
curl -i -X OPTIONS "$SUPABASE_URL/functions/v1/order-status" \
  -H "Origin: http://localhost:5174" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: authorization,content-type"
```
**Expected:** `200`, with `Access-Control-Allow-Origin` and `Access-Control-Allow-Headers` present.
**Broken behavior (pre-fix):** `401` — the function ran its full auth-check handler on the preflight itself.

### Payment spoofing

```bash
curl -i -X POST "$SUPABASE_URL/functions/v1/payment-webhook/<a-real-payment-id>" \
  -H "Content-Type: application/json" -H "apikey: $ANON_KEY" \
  -d '{"status":"success","verified":true}'
```
**Expected:** `400` ("has no automated gateway connected") and the payment's `status` in the database stays unchanged.
**Broken behavior (pre-fix):** `200 {"ok":true}` and the order was marked paid.

### Unauthenticated delivery-dispatch (found while writing this suite)

```bash
curl -i -X POST "$SUPABASE_URL/functions/v1/delivery-dispatch" \
  -H "Content-Type: application/json" -H "apikey: $ANON_KEY" \
  -d '{"delivery_id":"<a-real-delivery-id>","status":"delivered"}'
```
**Expected:** `401` (no `Authorization` bearer for a real user).
**Broken behavior (pre-fix):** `200 {"ok":true}` — the delivery and order were updated with no authentication at all.
