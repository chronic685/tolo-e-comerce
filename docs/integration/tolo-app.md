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
