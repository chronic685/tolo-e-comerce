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
4. It matches an existing marketplace customer by normalized phone
   (+251 format), or creates one if none exists, and mints a real Supabase
   session for them.
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

- Staff and admin accounts (`profiles.admin_tier` set) are never reachable
  through this flow — if the verified phone matches a staff/admin profile,
  the request is rejected with the same generic failure as an invalid code.
- Every failure case (invalid code, expired code, reused code, an
  unnormalizable phone, a staff/admin phone match) returns the same generic
  "Sign-in failed." message and status, so nothing about *why* it failed is
  observable from the outside.
- The function rate-limits by source IP, since there is no caller identity
  yet at this endpoint.
- No request body or URL field is ever trusted for identity — only the
  phone/name the Tolo backend itself returns.
