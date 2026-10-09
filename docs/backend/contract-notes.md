# Contract notes: gaps and ambiguities found while building the Tolo side

Source docs: `docs/integration/tolo-app.md`, `docs/integration/delivery-handoff.md`. The C# service is checked against
their documented shapes in `backend/tests/Tolo.Tests/Contract`. Each item says what was decided; none invents a business rule.

## Not specified by the docs

1. **How the Tolo app gets a login code.** The docs say the app "obtains a one-time code from the Tolo backend for its
   signed-in user" but define no endpoint. Built: `POST /app/me/login-code`, returning `{ code, expires_in }`. The route is
   ours, not a contract, and needs agreeing with the app team.
2. **How the Tolo app authenticates to its own backend.** Nothing is documented. `IAppAuthenticator` is a seam; `/app/*`
   answers 501 until real auth is wired, with a dev-only fake behind `TOLO_ALLOW_FAKE_APP_AUTH`.
3. **Code lifetime.** "A few minutes." Chosen: 180 seconds (`TOLO_LOGIN_CODE_TTL_SECONDS`).
4. **`already_used` vs `expired_code` for a late replay.** Redeeming spends a code even when it has expired, so the first
   late attempt is `expired_code` and any later one is `already_used`. The docs require "never verifies again", which holds.
5. **A valid code whose customer is gone or has no usable phone.** Not covered. Built: the code is spent and the answer is
   `invalid_code`.
6. **Invalid-code HTTP status.** The docs allow 200 or non-2xx. Built: 200 with `valid: false`.
7. **Malformed request body.** Not documented for verify-code or delivery-jobs. Built: `400 { "error": ... }`.
8. **Delivery job validation.** The docs list fields but not which are required. Built: required are `job_id` (uuid),
   `order_number`, pickup and dropoff (name plus an address or coordinates), dropoff phone (valid Ethiopian mobile,
   "a job is never sent without one"), at least one item with quantity >= 1, all four amounts (non-negative, currency `ETB`)
   and a payment whose `driver_collects_cash` matches the method. The pickup phone may be null (the doc says the store
   record may lack data, only the location is guaranteed).
9. **Same `job_id`, different payload.** The doc says a repeat "must return the same success response". Built: any repeat
   of a known `job_id` returns `{ "accepted": true }` and the first payload wins; a changed payload is ignored silently.
10. **Cancellation.** The doc names a "cancel-notify call" as a known follow-up with no shape. Not built.
11. **Receiver status codes.** The doc defines the success body only. Errors use 401 (bad key), 503 (key unset, mirroring
    `merchant-application-status`), 400 (bad body), 429 (rate limit).
12. **Key header form.** Docs say `Authorization: Bearer <key>`. Compared as the whole header, case-sensitive, no extra spaces.
13. **No total in a job.** Deliberate in the doc. The receiver stores the components and computes nothing.

## Inconsistencies inside the docs

- `tolo-app.md` says the marketplace never logs the code, phone or token; the same rule is followed here (request logs
  carry method, path, status only).
- `delivery-handoff.md` says `TOLO_BACKEND_URL` is "where the marketplace sends the job", with the job path
  `/integrations/tolo-marketplace/delivery-jobs`, and `tolo-app.md` puts verify-code under the same
  `/integrations/tolo-marketplace/` prefix. Built on that prefix; the marketplace's base URL must not include it.
- The status callback is documented as *sent by the Tolo side* but no trigger exists yet (no driver app events here).
  `IMarketplaceClient.SendDeliveryStatusAsync` implements the documented request and the retry rule (retry 5xx and network
  errors, never 4xx); nothing calls it until driver events exist.

## Fake or in-memory pieces needing real Tolo data

| Piece | Interface | Needs |
|---|---|---|
| Login code storage | `ILoginCodeStore` (`InMemoryLoginCodeStore`) | A table or cache shared by all instances; `RedeemAsync` must stay atomic (`update ... where used_at is null returning`) |
| Customer accounts (verified phone, name) | `ICustomerDirectory` (`InMemoryCustomerDirectory`) | The Tolo customer table |
| Received delivery jobs | `IDeliveryJobStore` (`InMemoryDeliveryJobStore`) | The Tolo driver dispatch tables; the real store must also dispatch drivers |
| Tolo app authentication | `IAppAuthenticator` (not configured / dev fake) | The app's session or token scheme |
| Driver events to callbacks | none yet | Wire driver status changes to `SendDeliveryStatusAsync` |

All are marked `TODO(tolo-data)` or `TODO(tolo-auth)` in the source. Until they are replaced, the service must not receive
real traffic: in-memory state is lost on restart and not shared between instances.

`tolo_phone_links` is real: `EfPhoneLinkStore` calls the migration's `tolo_account_for_phone()` and `link_tolo_phone()`. It is
not exposed over HTTP in Phase 1; it is the building block for porting `tolo-app-login` in Phase 2. The connecting database
role needs EXECUTE on those functions (the migration grants them to `service_role` only).
