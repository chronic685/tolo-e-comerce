# Admin: customer and merchant management

What an admin can see, edit, delete and close, and who is allowed to. Every rule here is
enforced by the database (migrations 0093 to 0097); the admin dashboard also hides the buttons
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

## Customers (migration 0096)

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

## Merchants (migrations 0093 to 0097)

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

## Private contact details (migration 0095)

A merchant's phone, email, owner name, owner phone, owner email and registration number used to sit on the
`merchants` row, which any visitor could read for an active merchant. They now live in `merchant_private`,
readable only by the merchant's own owner and staff and by Tolo staff whose pages reach merchants. The
storefront and the Tolo-embedded marketplace never read those columns, so they are unchanged. Anonymous
visitors and signed-in customers get only the safe public columns of `merchants` (name, category, status, area,
coordinates, rating through the computed columns). Tests: `supabase/tests/admin_detail_controls.test.ts` (SQL)
and `tests/smoke/merchant-contacts-private.test.ts` (against the real API).
