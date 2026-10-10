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
items, and **its own share of the checkout's single delivery fee and rider
tip**: split in proportion to each merchant order's item subtotal (before
discount). Leftover cents from rounding go one each to the earliest merchant
orders, so the jobs' shares always add up to exactly what the customer was
charged, and `amounts.delivery_fee` / `amounts.rider_tip` are per job, never
the whole checkout's. If no subtotal is known the split is even. A merchant
order that was rejected or cancelled before the handoff sends no driver, so
it takes no share and the others split the whole amount. (A sibling rejected
*after* another job was already sent is not re-split; its share goes
uncollected, and the existing refund flow leaves the delivery fee to manual
admin handling anyway.)

**No Tolo-verified phone, no automatic handoff.** If the customer has no
phone linked to a Tolo session (they signed up by email), the marketplace does
not send the job, and never substitutes the phone typed into the address.
The job is created with `handoff_error = no_verified_phone` and
`needs_manual_handling = true`, and the admin Orders page shows a red
"Delivery not sent: customer has no Tolo-verified phone. Arrange it manually"
badge on that merchant order. Other jobs the marketplace can't build
(`payment_not_settled`, `no_items`, `missing_pickup_location`,
`missing_dropoff_location`) are flagged the same way. A Tolo Delivery outage is
*not* flagged: it keeps `handoff_error` only and retries. Re-running
`delivery-handoff` for a flagged order once it can be sent (for example the
customer has since signed in through the Tolo app) sends it and clears the flag.

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
    "phone": "+251911000002"
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
- `dropoff`: the delivery address chosen at checkout. **`phone` is always
  the phone the customer signed in to Tolo with**, the same verified phone
  `tolo-app-login` links to their account. A job is never sent without one.
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
(before discount), the `discount` that applies to it, and this job's share of
the checkout's `delivery_fee` and `rider_tip` (see above). There is deliberately **no
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

### The merchant's side of the order status

The merchant dashboard shows ONE primary button per order, and the `order-status` function (and, for every client
write, a database trigger, migration 0098) only lets the merchant take the next legal step on its own orders:

| Order status | Primary button | Moves to |
|---|---|---|
| `new` | Accept & start preparing | `processing` (one atomic update; `accepted` is recorded in the history at the same instant) |
| `processing` | Ready for pickup | `ready_for_pickup` (opens the delivery record and, when enabled, hands the job to the Tolo Delivery app) |
| `ready_for_pickup` | Handed to driver (Picked up by customer for a self-pickup order) | `picked_up` |

Rejecting a new order, or cancelling one that is being prepared or ready, is a separate secondary action with a
reason; cancelling stays possible until the driver job is `accepted`. `delivered` and `completed` are driven by the
driver and the callbacks above, and the merchant gets no button for them. The `accepted` value stays in the status
enum for orders that sit in it and for this contract; the one-button accept simply no longer stops there, so a customer
receives one message ("accepted and is being prepared"), and the customer's tracking shows Accepted and Preparing as
one "Preparing your order" step. **The payloads and callbacks in this document are unchanged.**

## `delivery_jobs` table

One row per merchant order (`merchant_order_id`, unique). Columns: `status`
(`invoked`/`accepted`/`picked_up`/`delivered`/`failed`), `driver_ref`,
`eta_at`, `failure_reason`, `dispatched_at`, `handoff_attempts`,
`handoff_error`, `needs_manual_handling`, and an `invoked_at`/`accepted_at`/`picked_up_at`/
`delivered_at`/`failed_at` timestamp for each status.

Read access (RLS): the customer who owns the order, the merchant (owner or
staff) it belongs to, and admins and staff with the Delivery Ops or Orders page
(`has_admin_page(['delivery_ops', 'orders'])`). **Nobody can write it** except the service
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
npx supabase db push        # migrations 0080, 0081
npx supabase functions deploy delivery-handoff delivery-status-callback order-status
```

`TOLO_BACKEND_URL`, `TOLO_BACKEND_SHARED_KEY` and `TOLO_BACKEND_INBOUND_KEY`
must already be set. Orders that went ready *before* switching on have no job
and aren't sent retroactively.

## Customer cancellation

A customer can cancel an order from placement until a driver is assigned: any
order status before `picked_up`, and only while the delivery job is `invoked`
(or there is no job yet). Once the job is `accepted` or later, the
`order-status` function refuses (`400`). A cancel marks an `invoked` job and its
`deliveries` row `cancelled` (final: a late callback is refused with
`invalid_transition`), refunds a paid order through the usual flow, and notifies
the merchant.

**Known follow-up, not built:** the marketplace tells the Tolo Delivery app
nothing when it cancels. A job that was already sent (`dispatched_at` set) and
is still `invoked` stays open on the Tolo side, so a driver can still see it and
try to accept it; that `accepted` callback is then refused, which the Tolo app
has to handle. Once the real Tolo Delivery backend is connected, a cancel-notify
call is needed for that window. The same call would be needed for the
accepted-but-not-yet-picked-up window if cancelling were ever allowed after a
driver accepts (it is deliberately blocked today).

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
