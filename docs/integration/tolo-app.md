# Tolo app → marketplace one-login handoff

Lets a customer who is already signed in on the Tolo Delivery app open the
marketplace site inside the app's WebView, already signed in, without
re-entering a password.

## Flow

1. The Tolo app opens `https://<marketplace>/auth/handoff?code=<code>&embed=app`
   in its WebView. `code` is a one-time login code the Tolo app obtains from
   the Tolo backend for its currently signed-in user. `next` (optional) is
   the marketplace path to land on afterward, e.g. `&next=/orders`; it
   defaults to `/`.
2. The marketplace frontend POSTs `{ code }` to the `tolo-app-login` Edge
   Function.
3. That function calls the Tolo backend's verify endpoint (contract below)
   server-to-server to redeem the code for the customer's verified phone and
   name.
4. It looks up the marketplace account **linked** to that normalized phone
   (+251 format) in `tolo_phone_links`. If there isn't one, it creates a new
   customer and links it. Then it mints a real Supabase session for that
   account. See "Phone matching" below.
5. The frontend stores that session, strips `code` from the URL immediately
   (`history.replaceState`) so it can never be replayed, and redirects to
   `next`.

Only the phone and name returned by the Tolo backend are ever trusted. The
request body/URL never supplies a phone or any other identity field.

## Verify-code contract (Tolo backend must implement this)

**Request** — from the marketplace's `tolo-app-login` function to the Tolo
backend:

```
POST {TOLO_BACKEND_URL}/integrations/tolo-marketplace/verify-code
Authorization: Bearer <shared secret>
Content-Type: application/json

{ "code": "<the one-time code>" }
```

**Response, code valid** (200):

```json
{ "valid": true, "phone": "+251912345678", "name": "Abebe Kebede" }
```

- `phone` should be the customer's Tolo-verified phone number. Any common
  format is fine (`0912345678`, `251912345678`, `+251912345678`, with or
  without spaces/dashes) — the marketplace normalizes it.
- `name` is the display name on file for that customer.

**Response, code invalid/expired/reused** (200, or any non-2xx — the
marketplace treats a non-2xx response and `"valid": false` identically):

```json
{ "valid": false, "reason": "invalid_code" | "expired_code" | "already_used" }
```

### Requirements on the Tolo side

- **One-time**: once a code has been redeemed via this endpoint — regardless
  of whether the marketplace's subsequent sign-in succeeds — it must never
  verify again. A replay must return `"already_used"`.
- **Short-lived**: codes must expire quickly (a few minutes is typical for
  this kind of handoff). An expired code must return `"expired_code"`.
- **Authenticated**: only accept calls carrying the shared secret above.
- The marketplace never sees or stores this shared secret anywhere except as
  a Supabase Edge Function secret (see below), and never logs the code,
  phone, or any token.

## Secrets to set (marketplace side)

Set these as Supabase Edge Function secrets — not in code, not in `.env`
committed to the repo:

- `TOLO_BACKEND_URL` — base URL of the Tolo backend's server-to-server API
  (e.g. `https://api.toloapp.example`).
- `TOLO_BACKEND_SHARED_KEY` — the bearer token the marketplace sends as
  `Authorization: Bearer <value>` on the verify-code call above.

```
npx supabase secrets set TOLO_BACKEND_URL=... TOLO_BACKEND_SHARED_KEY=...
```

## Security notes

- Staff and admin accounts (any `tolo_*` role, or `profiles.admin_tier`
  set) are never reachable through this flow — if the verified phone is
  linked to a staff/admin account,
  the request is rejected with the same generic failure as an invalid code.
- Every failure case (invalid code, expired code, reused code, an
  unnormalizable phone, a staff/admin phone match) returns the same generic
  "Sign-in failed." message and status, so nothing about *why* it failed is
  observable from the outside.
- The function rate-limits by source IP, since there is no caller identity
  yet at this endpoint.
- No request body or URL field is ever trusted for identity — only the
  phone/name the Tolo backend itself returns.

## Phone matching

A Tolo-verified phone signs in to the account recorded for it in
`tolo_phone_links` (migration 0072), and nothing else:

- **Nobody can write that table except the login flow.** Users have no
  insert, update or delete policy or grant on it. Rows are created only by
  `link_tolo_phone()` (service role only), which `tolo-app-login` calls
  right after the Tolo backend has verified the phone, when it creates the
  account for that phone's first login. Each phone links to one account and
  each account to one phone (both unique).
- **`profiles.phone` is never used for matching.** Every account can edit
  its own profile row, phone included. Matching on it let anyone set their
  profile phone to someone else's number and capture that person's
  Tolo-app login. `profiles.phone` is still filled in on new accounts, for
  display only.
- **Consequence:** an existing marketplace account that was created by
  email signup is *not* merged with a Tolo phone just because its profile
  phone matches. That person's first Tolo-app login creates a separate
  account. Merging would need its own ownership proof, such as a signed-in
  user confirming a Tolo code, which isn't built.
- New accounts' synthetic emails are random (`tolo-<uuid>@app.tolo.internal`),
  not derived from the phone, so nobody can block a phone's first login by
  pre-registering its email.

# Apply to become a merchant (Tolo app → marketplace)

A customer signed in on the Tolo app can apply to sell on the marketplace.
Tolo admins review the application; on approval the customer's existing,
phone-verified account becomes the owner of a new merchant account. There
is no separate merchant signup and no password.

## Opening the form

The Tolo app opens the form through the same one-login handoff as above,
with `next` pointing at it:

```
https://<marketplace>/auth/handoff?code=<code>&embed=app&next=/merchant/apply
```

- The phone is never collected or re-verified on the form. It is the phone
  the Tolo backend returned from verify-code, which `tolo-app-login` linked
  to the customer's account in `tolo_phone_links` (see "Phone matching").
  The application is stored against that phone.
- The applicant enters business name, category (from the marketplace's
  admin-managed categories), address, and a **10-digit TIN** (Taxpayer
  Identification Number, digits only, required). Submitting creates a
  `pending` application and shows a confirmation screen.
- **The business license photo is no longer asked for.** The upload is
  switched off in the form (`LICENSE_UPLOAD_ENABLED` in
  `frontend/src/lib/merchantApplication.ts`) but nothing was removed: the
  storage bucket, the optional photo argument of
  `submit_merchant_application()` and the admin "View photo" button for old
  applications all still work, so turning the constant back on restores it
  alongside the TIN.
- **The TIN is provided by the applicant and not verified by the system.**
  Admins see it with a copy button and the note "Provided by applicant,
  verify manually".
- **A TIN can belong to only one merchant at a time.** It is unique across
  all `pending` and `approved` applications and all merchants, enforced in
  the database. Submitting a TIN that is already taken fails with
  `tin_already_registered`, a malformed one with `invalid_tin`. A rejected
  application frees its TIN. Approving an application carries its TIN over to
  the merchant (`merchant_tins`), and an admin can correct it afterwards.
- `submit_merchant_application(p_business_name, p_category_id, p_address,
  p_tin, p_license_photo_url default null)` replaced the four-argument
  version (migration 0094).
- Only one application per phone can be pending. After a rejection the
  applicant can reapply; the form shows the admin's note. An approved
  applicant can't apply again.
- In embed mode the confirmation and status screens show a **Done** button
  that fires the existing `toloapp://close` event.

## Review

Applications are reviewed in the admin dashboard, on the **Merchants** page
under its **Merchant Applications** tab (the tab shows a count of pending
applications; the old `/merchant-applications` address redirects there). Only
**admin and super_admin accounts** see the tab or can approve and reject:
staff with the Merchants page permission can't, and the database refuses them
too (migrations 0073 and 0093), not only the hidden buttons. Approval creates
an `active` merchant owned by the applicant's account, labelled as coming from
the Tolo app; merchants who signed up in the merchant dashboard are labelled
"Dashboard sign-up" in the same list. Rejection records an optional note,
which is shown to the applicant.

## Bridge signal: when to show the "Merchant" button

Review can happen hours after the applicant left the WebView, so the
marketplace does **not** push anything to the app at approval time, and no
`toloapp://` event is involved. Instead the **Tolo backend asks the
marketplace** whenever the app needs to know (pull, not push).

**Request**: from the Tolo backend to the marketplace, server-to-server.
Never call it from the app, because the key must not ship in the app.

```
POST https://<supabase-project>.supabase.co/functions/v1/merchant-application-status
Authorization: Bearer <TOLO_BACKEND_INBOUND_KEY>
Content-Type: application/json

{ "phone": "+251912345678" }
```

`phone` is the user's Tolo-verified phone, in any common format; the
marketplace normalizes it the same way it does for verify-code.

**Response** (200):

```json
{
  "phone": "+251912345678",
  "is_merchant": true,
  "application": {
    "id": "8c1d…",
    "status": "approved",
    "submitted_at": "2026-10-01T09:12:00Z",
    "reviewed_at": "2026-10-01T14:40:00Z",
    "note": null
  }
}
```

- `is_merchant`: **show the Merchant button exactly when this is `true`.**
  It means an `active` merchant is owned by the account linked to this
  phone in `tolo_phone_links` (never matched on the editable profile phone). It goes back to `false` if that merchant is later suspended or
  closed.
- `application`: the phone's most recent application, or `null` if it has
  never applied. `status` is `pending`, `approved` or `rejected`. `note` is
  the admin's reason when `rejected` (show it so the user knows what to
  fix), and is always `null` otherwise.
- Errors: `401` wrong or missing key, `400` phone not a valid Ethiopian
  mobile number, `503` key not configured on the marketplace, `500`
  anything else. Treat any error as "don't change the button", not as
  "not a merchant".

**When to call it**: on app launch and whenever the app returns to the
foreground. If an application is `pending`, also call it when the user
opens the screen where the Merchant button or the application status
appears. Caching the answer for a few minutes is fine. Approval then shows
up the next time the user opens the app, whether or not they were watching
when it happened.

## Secrets (merchant application)

Marketplace side, as a Supabase Edge Function secret:

- `TOLO_BACKEND_INBOUND_KEY`: the bearer token the Tolo backend must send
  to `merchant-application-status`. It is separate from
  `TOLO_BACKEND_SHARED_KEY`, which is the key the marketplace sends *to*
  the Tolo backend, so each direction can be rotated on its own.

```
npx supabase secrets set TOLO_BACKEND_INBOUND_KEY=...
```

`merchant-application-status` deploys with Supabase JWT verification off
(`supabase/config.toml`), because the Tolo backend holds no Supabase JWT.
The key is the only gate, and an unset key refuses every request.

## Merchant sign-in (what the Merchant button opens)

Approved merchants have no password. The Merchant button signs them in to
the merchant dashboard the same way the customer handoff works, with a
fresh one-time code from the same Tolo backend endpoint.

### Flow

1. The Tolo app gets a one-time code for its signed-in user (the same kind
   of code, from the same place, as for the customer handoff) and opens
   this in its WebView:

   ```
   https://<merchant-dashboard>/auth/handoff?code=<code>&embed=app
   ```

   `next` (optional) is a merchant-dashboard path to land on afterward,
   e.g. `&next=/orders`. It defaults to `/`. Only in-app paths are honored;
   anything else falls back to `/`.
2. The merchant dashboard POSTs `{ code }` to the `tolo-merchant-login`
   Edge Function.
3. That function redeems the code with the Tolo backend using the **same
   verify-code contract** described above. No new Tolo-side endpoint is
   needed.
4. It signs in **only** the account that is all of the following:
   - linked to the verified phone in `tolo_phone_links`, using the same
     unwritable link as the customer login and never `profiles.phone`;
   - the owner of the merchant created when that phone's **latest**
     merchant application was **approved**. Pending or rejected
     applications don't count, and neither does a reapplication that is
     still under review;
   - not a staff/admin account.
5. It mints a real Supabase session for that account. The dashboard stores
   it, strips `code` from the URL immediately, and redirects to `next`.

**`tolo-merchant-login` never creates an account.** A phone with no link,
or no approved application, gets the same generic failure as an invalid
code:

```
POST {SUPABASE_URL}/functions/v1/tolo-merchant-login
{ "code": "<the one-time code>" }

200 → { "session": { "access_token": "…", "refresh_token": "…", "expires_in": 3600, "token_type": "bearer" } }
401 → { "error": "Sign-in failed." }   (every rejection reason looks the same)
400 → { "error": "code is required." }
429 → rate limited by source IP (action merchant_app_login)
```

### For the Tolo app

- Show the Merchant button when `merchant-application-status` returns
  `is_merchant: true` (see the bridge signal above). On tap, get a fresh
  code and open the URL in step 1.
- A suspended or closed merchant can still sign in, and the merchant
  dashboard then shows that status instead of the store. `is_merchant` is
  already `false` for them, so the button normally won't be shown anyway.
- No new secrets: `tolo-merchant-login` uses the same `TOLO_BACKEND_URL` /
  `TOLO_BACKEND_SHARED_KEY` as `tolo-app-login`.
