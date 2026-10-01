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
  admin-managed categories), address, and a business license photo (JPEG,
  PNG or WebP, at most 5 MB). Submitting creates a `pending` application
  and shows a confirmation screen.
- Only one application per phone can be pending. After a rejection the
  applicant can reapply; the form shows the admin's note. An approved
  applicant can't apply again.
- In embed mode the confirmation and status screens show a **Done** button
  that fires the existing `toloapp://close` event.

## Review

Applications are reviewed in the admin dashboard (**Merchant Applications**)
by **admin and super_admin accounts only**. Staff with page permissions
(including "Merchants") can't see or review them. Approval creates an
`active` merchant owned by the applicant's account. Rejection records an
optional note, which is shown to the applicant.

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

## Not yet defined

- **What the Merchant button opens.** The merchant dashboard has no
  app-login handoff route yet, and approved merchants have no password.
  Until one exists (the same `tolo-app-login` code exchange, added to the
  merchant dashboard), the button has nowhere to sign them in.
