# Admin: customer and merchant management

What an admin can see, edit, delete and close, and who is allowed to. Every rule here is
enforced by the database (migrations 0093 to 0099); the admin dashboard also hides the buttons
a member of staff may not use, but that is a convenience, not the protection.

"Admin tier" below means an `admin` or `super_admin` account. "Staff" means a Tolo account
with a page permission (Customers, Merchants, ...).

## Who may do what

| Action | Customers | Merchants |
|---|---|---|
| View the detail | Staff with the **Customers** page | Staff with the **Merchants** page |
| Edit name, email, addresses | Staff with the Customers page | n/a |
| Edit business, store, owner name and email, hours, logo, cover | n/a | Staff with the Merchants page |
| Edit **phone numbers**, registration number | **Admin tier only** | **Admin tier only** |
| See or edit the **TIN** (see `tolo-app.md`) | n/a | **Admin tier only** |
| See payouts, wallet balance, applications | n/a | **Admin tier only** |
| Approve or reject a merchant | n/a | **Admin tier only** (migration 0093) |
| Suspend and reinstate | Staff with the page | Staff with the page |
| Disable / enable an account | Staff with the Customers page | n/a |
| **Delete (anonymize)** a customer | **Admin tier only** | n/a |
| **Close** a merchant | n/a | **Admin tier only** |
| **Reopen** a closed merchant | n/a | Staff with the page, or admin tier |
| **Hard delete** a merchant | n/a | **Admin tier only**, and only with no history |

Every edit, anonymize, close, reopen and delete writes an `audit_logs` row: who, when, what changed
(before and after for edits). Phone numbers and the registration number are masked to their last four
characters in the log, and the TIN is audited by its last four digits only.

## Customers (migration 0099)

**Detail** (`admin_customer_detail`): profile, email and last sign-in (from the login), Tolo link status
(admin tier sees the linked phone, staff see that a link exists), addresses, order history with totals and
statuses, refunds, reviews, cart and favorites counts, and this customer's audit trail.

**Edit** (`admin_update_customer`, `admin_update_customer_address`): name, email, addresses. The customer's
phone is admin tier only. Changing a profile phone never reads or writes `tolo_phone_links` or
`profiles.phone_verified`: the Tolo link, not the profile, decides which account a verified phone belongs
to (migration 0072), so an edit here cannot move a verified phone to another account. A phone that is
verified for a different account is refused. *There is no language setting to edit: the apps keep the
language in the browser, not on the account.*

**Disable / enable** is the existing suspend and reactivate on the Customers page.

**Delete means anonymize.** Orders, payouts and refunds keep their history.

- Removed: name (becomes "Deleted customer"), phone, avatar, email, password, sign-in (the login is banned
  for good and every session revoked), the Tolo link, cart, favorites, notifications, and every address no
  order used.
- Kept: the order rows and the address row each order points at, overwritten to "Deleted customer" with no
  phone or coordinates; reviews and support tickets (shown under "Deleted customer"); refunds.
- Refused while the customer has an order in progress (`new` through `delivered`) or a refund still
  `pending`, and for staff or admin accounts and for anyone who owns or works for a merchant.
- The admin must type `DELETE`. An anonymized account cannot be edited or switched back on by any client.

## Merchants (migrations 0093 to 0099)

**Detail** (`admin_merchant_detail`): business, owner and contact, store (hours, logo, cover, pickup
address, preparation time), source label (Tolo app or Dashboard sign-up), status, product and order counts,
rating, commission rules, documents, audit trail; and for admin tier the TIN (with a copy button and
"Provided by applicant, verify manually"), payouts, wallet balance and applications. *No bank details are
stored anywhere in the schema: payouts are recorded as settlements.* The commission rate is edited on the
Pricing Rules page.

**Edit** (`admin_update_merchant`, `set_merchant_tin`): business fields, owner and contact, store fields.
Staff cannot change phone numbers or the registration number.

**Close** is the reversible way to take a merchant away. It keeps every record:

- `merchants.status` and `stores.status` become `closed`, the previous values remembered;
- every published product is paused and flagged, so Reopen re-lists exactly those (one that no longer
  passes the listing-eligibility check stays paused);
- the owner and staff lose every merchant-side right, because `is_merchant_member()` is false for a closed
  merchant (the owner can still read their own merchant row, so the dashboard can say why);
- refused while the merchant has an order in progress.

The admin must type the merchant name. **Reopen** puts it all back.

**Hard delete** only when the merchant has never had an order, a payout, a wallet movement or a financial
adjustment; otherwise the dashboard offers Close. The admin must type the merchant name. Cascade rules:

- deleted with the merchant: its store, products, variants, inventory, product image rows, cart lines,
  favorites and reviews of those products, its staff rows, document rows, private contact row, TIN row and
  wallet row;
- kept: the merchant's application (with `merchant_id` cleared and `merchant_deleted_at` set, so the applicant
  can apply again and the TIN is free), and the owner's own login and profile;
- left in place, inert: pricing and discount rules scoped to the merchant (no foreign key);
- **storage files are not removed by the database.** The function returns the file locations and the admin
  dashboard deletes them through the Storage API straight after; anything missed is an unreferenced file, never a
  dangling reference.

## Private contact details: expand, then contract (migrations 0099 and 0100)

A merchant's phone, email, owner name, owner phone, owner email and registration number sit on the `merchants` row, which
any visitor can read for an active merchant. They move to `merchant_private`, readable only by the merchant's own owner and
staff and by Tolo staff whose pages reach merchants. The storefront and the Tolo-embedded marketplace never read those columns, so they
are unchanged.

Dropping the columns in one step would break any code still reading them, so it ships in two phases that never break anything:

1. **Expand, `0099_expand_merchant_private_and_admin_controls.sql`.** Additive only. It creates `merchant_private`, backfills it, keeps the
   two copies identical with a trigger in each direction, and adds the safe `merchants_public` view and the admin customer / merchant
   functions. Old code (reads and writes `merchants.phone`) and new code (reads and writes `merchant_private`) both work. **It does not close the
   exposure**, and cannot without breaking old code. New code must *upsert* into `merchant_private`: during this phase inserting a merchant already
   creates its (empty) private row.
2. **Contract, `0100_contract_drop_public_merchant_contacts.sql`.** Apply it **only after every Edge Function and dashboard that reads the old
   columns is deployed**. It stops the sync, drops the six columns from `merchants` (which closes the exposure: anonymous visitors and signed-in
   customers read none of them) and makes the approval write `merchant_private` directly.

The code is written to be deployed before or after the expand migration, in any order: `order-status` and `delivery-handoff` read the
phone through `_shared/merchant_contact.ts` (try `merchant_private`, fall back to `merchants.phone` only if that query fails), the merchant
dashboard saves contacts with `saveMerchantContact` (the same fallback), and the admin Merchants page tries the `merchant_private` embed and
falls back to the old columns. None of them needs a change for the contract migration.

**Rollout order:** back up; apply 0099; deploy `order-status`, `delivery-handoff`, `review-merchant-application`, then the dashboards; check nothing
still selects the old columns; back up again; apply 0100. Tests: `supabase/tests/merchant_contacts_phases.test.ts` (both phases, including that an
anonymous request reads none of the sensitive fields after 0100), `supabase/tests/admin_detail_controls.test.ts`, and
`tests/smoke/merchant-contacts-private.test.ts` (against the real API, with all migrations applied).
