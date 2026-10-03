# Marketplace → Tolo Delivery app: delivery handoff

When a merchant marks an order **ready for pickup**, the marketplace hands
it to the Tolo Delivery app's driver side as a *delivery job*. The Tolo
Delivery app then reports the job's progress back (driver assigned, picked
up, delivered, failed), and the marketplace shows that to the customer.

**Status: built and tested against a mock, deliberately disconnected.** The
Tolo Delivery backend doesn't implement either side of this contract yet.
Nothing is sent until `TOLO_DELIVERY_HANDOFF_ENABLED=true` is set (see
"Turning it on"). Until then marking an order ready behaves exactly as it
did before.

## Flow

1. A merchant moves an order to `ready_for_pickup` (the existing
   `order-status` function). As before, that opens the order's `deliveries`
   row for the admin Deliveries page.
2. `order-status` then calls the internal `delivery-handoff` function, which
   creates the order's `delivery_jobs` row (status `invoked`) and POSTs the
   job to the Tolo Delivery app (contract below).
3. The Tolo Delivery app dispatches a driver and calls the marketplace's
   `delivery-status-callback` as the job progresses (contract below). Each
   callback updates the job and the order the customer sees.
4. The customer's order page shows the job's status.

The handoff never blocks or undoes the merchant's status change. If the Tolo
Delivery app is down or rejects the job, the job keeps `dispatched_at = null`
and a short `handoff_error` (`tolo_http_503`, `tolo_unreachable`,
`tolo_rejected`, `payment_not_settled`, ...), and the order stays
`ready_for_pickup`. Calling `delivery-handoff` again for that order retries
(service-role key; there is no retry button yet). A job the Tolo side already
acknowledged is never sent twice.

**One job per merchant order**, not per checkout: a checkout with items from
two merchants has two pickups, so two jobs. Each carries its own `job_id` and
items. The checkout's single delivery fee and rider tip are attached to the
*first* merchant order (earliest created) and are `0` on the others, so no
driver is told to collect them twice.

## Job payload (marketplace → Tolo Delivery app)

**Request:**

```
POST {TOLO_BACKEND_URL}/integrations/tolo-marketplace/delivery-jobs
Authorization: Bearer <TOLO_BACKEND_SHARED_KEY>
Content-Type: application/json
```

```json
{
  "job_id": "5b0c0f6e-6a53-4c0e-9d57-0f1d3a9d1e11",
  "order_number": "TL-1042",
  "pickup": {
    "name": "Abebe's Kitchen",
    "address": "Bole Rd, Addis Ababa",
    "latitude": 9.01,
    "longitude": 38.76,
    "phone": "+251911000001"
  },
  "dropoff": {
    "name": "Sara T.",
    "address": "Piassa, Addis Ababa",
    "latitude": 9.03,
    "longitude": 38.75,
    "phone": "+251911000002",
    "phone_verified": true
  },
  "items": [
    { "name": "Doro Wat", "quantity": 2 },
    { "name": "Injera pack", "quantity": 1 }
  ],
  "amounts": {
    "currency": "ETB",
    "item_subtotal": 450,
    "discount": 0,
    "delivery_fee": 60,
    "rider_tip": 0
  },
  "payment": { "method": "cash_on_delivery", "driver_collects_cash": true }
}
```

- `job_id`: the marketplace's id for the job. **Echo it in every callback.**
  Treat the POST as idempotent on it: a repeat of the same `job_id` must
  return the same success response, not create a second job.
- `order_number`: the customer-facing number (`TL-####`).
- `pickup`: the merchant's store. `phone` is the merchant's phone.
  `latitude`/`longitude`/`address` come from the store record; any may be
  `null`, but the marketplace won't send a job with no pickup (or dropoff)
  location at all.
- `dropoff`: the delivery address chosen at checkout. **`phone` is the
  phone the customer signed in to Tolo with** (`phone_verified: true`), the
  same verified phone `tolo-app-login` links to their account. Only when the
  customer has no Tolo session phone (they signed up with email) does it fall
  back to the phone typed into the address, with `phone_verified: false`.
- `items`: active items only (items the merchant removed are excluded).
  Item prices are not included.

### Payment and what the driver collects

`payment.method` is one of:

- **`cash_on_delivery`** (`driver_collects_cash: true`): the customer hasn't
  paid. **The driver collects the order's amount in cash on delivery.**
- **`already_paid`** (`driver_collects_cash: false`): the customer paid
  online. **The driver collects nothing.**

A job is not sent while an online payment is still unsettled
(`handoff_error = payment_not_settled`).

### The marketplace does not compute the amount the driver sees

`amounts` hands over **components only**: this merchant's `item_subtotal`
(before discount), the `discount` that applies to it, the checkout's
`delivery_fee` and the customer's `rider_tip`. There is deliberately **no
total** field. **The Tolo Delivery app computes and displays what the driver
sees and collects from these components, the way that app already works.**
The marketplace doesn't decide it.

For reference only, the marketplace's own checkout combines them as
`item_subtotal − discount + delivery_fee`, and records the tip separately.
Whether and how the Tolo Delivery app includes the tip in a cash collection
is that app's decision.

### Response

```json
{ "accepted": true }
```

Any `2xx` with `"accepted": true` means the job was received; the
marketplace sets `dispatched_at`. Anything else (non-2xx, `accepted` missing
or `false`, a timeout after 10 s) leaves the job unacknowledged and
retryable.

## Status callback (Tolo Delivery app → marketplace)

Server-to-server, with the same inbound key the other Tolo-backend callers
use. Never call it from a driver's or customer's device: the key must not
ship in an app.

```
POST https://<supabase-project>.supabase.co/functions/v1/delivery-status-callback
Authorization: Bearer <TOLO_BACKEND_INBOUND_KEY>
Content-Type: application/json

{
  "job_id": "5b0c0f6e-6a53-4c0e-9d57-0f1d3a9d1e11",
  "status": "accepted",
  "driver_ref": "drv-8841",
  "eta_minutes": 25
}
```

| Field | Required | Notes |
|---|---|---|
| `job_id` | yes | The `job_id` from the handoff. |
| `status` | yes | `accepted` (driver assigned), `picked_up`, `delivered` or `failed`. |
| `driver_ref` | with `accepted`, `picked_up`, `delivered` (unless sent earlier) | Opaque reference to the driver, at most 100 characters. No name or phone: the marketplace stores and shows none. Send a different one with `accepted` to reassign. |
| `eta_minutes` | no | Whole minutes **from now** until delivery, 0 to 1440. Refreshable: send it again with the current status. Cleared on `delivered`/`failed`. |
| `failure_reason` | no | With `failed`, at most 500 characters. |

**Response, applied or already applied** (200):

```json
{ "ok": true, "job_id": "5b0c…", "status": "accepted", "applied": true }
```

`applied: false` means the job already had exactly this state. Repeats are
safe, so retry a callback until you get a `200`.

**Errors:** `401` wrong or missing key · `400` malformed body, unknown
`status` · `404` unknown `job_id` · `409` the status can't follow the job's
current status · `422` `driver_ref` missing · `503` key not configured on the
marketplace · `500` anything else. Don't treat a `4xx` as retryable.

### Ordering rules

`invoked → accepted → picked_up → delivered`, forward only (a status may be
skipped, e.g. `accepted → delivered`, if its callback was lost). `failed` is
allowed from any state that isn't final. **`delivered` and `failed` are
final**: nothing can follow them, so a job that fails and is re-dispatched
needs a new handoff (not built).

### What each callback does on the marketplace

- `accepted`: the job shows "Driver assigned" (plus the ETA, if sent).
- `picked_up`: the order moves `ready_for_pickup → picked_up`, the customer
  is notified ("Your order has been picked up").
- `delivered`: the order moves to `delivered` and then `completed`, the same
  auto-completion the admin Deliveries page applies, and the customer is
  notified.
- `failed`: the job shows a delivery problem. **The order status doesn't
  change**: the merchant and Tolo ops resolve it.

A late callback never moves a cancelled or rejected order.

## `delivery_jobs` table

One row per merchant order (`merchant_order_id`, unique). Columns: `status`
(`invoked`/`accepted`/`picked_up`/`delivered`/`failed`), `driver_ref`,
`eta_at`, `failure_reason`, `dispatched_at`, `handoff_attempts`,
`handoff_error`, and an `invoked_at`/`accepted_at`/`picked_up_at`/
`delivered_at`/`failed_at` timestamp for each status.

Read access (RLS): the customer who owns the order, the merchant (owner or
staff) it belongs to, and admins (`has_admin_page(['delivery_ops'])`, i.e.
admin tier or Delivery Ops staff). **Nobody can write it** except the service
role, which only the two functions above use.

## Secrets

**No new credentials.** The handoff reuses the two keys the other Tolo
integrations use:

- `TOLO_BACKEND_URL` and `TOLO_BACKEND_SHARED_KEY`: where and how the
  marketplace *sends* the job (same as `tolo-app-login`).
- `TOLO_BACKEND_INBOUND_KEY`: how the Tolo Delivery app authenticates its
  *callbacks* (same as `merchant-application-status`).

One new **switch**, not a secret:

- `TOLO_DELIVERY_HANDOFF_ENABLED`: `true` to enable the handoff. Unset or
  anything else, `delivery-handoff` does nothing: no job row, no outbound
  call.

`delivery-handoff` is internal. It's called only by `order-status`, with the
service-role key as the bearer, and refuses everything else (a signed-in
user's token included). Both new functions deploy with JWT verification off
(`supabase/config.toml`).

## Turning it on

When the Tolo Delivery backend implements both endpoints above:

```
npx supabase secrets set TOLO_DELIVERY_HANDOFF_ENABLED=true
npx supabase db push        # migration 0080
npx supabase functions deploy delivery-handoff delivery-status-callback order-status
```

`TOLO_BACKEND_URL`, `TOLO_BACKEND_SHARED_KEY` and `TOLO_BACKEND_INBOUND_KEY`
must already be set. Orders that went ready *before* switching on have no job
and aren't sent retroactively.

## Not covered

- **Live driver location / GPS tracking**: a separate backlog item. The
  customer sees the job's reported status and ETA only.
- **Re-dispatch** after `failed`, and a retry button for an unacknowledged
  handoff.
- A distinct "out for delivery" stage: the Tolo Delivery app reports
  `picked_up`, and the customer page labels it "Picked up, out for delivery".
- Merchant and admin dashboard views of the job.
- The existing `delivery-dispatch` function (admin-driven status pushes onto
  `deliveries`) is unchanged and independent of this flow.
