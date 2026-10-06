# Development guidelines

Rules for working on this repo, each one written down because something real
went wrong or nearly did. Read this before changing tests, migrations,
uploads, list queries or scheduled jobs. Numbers are from the live project's
usage audit on 2026-10-03; free-tier limits are Supabase's published ones
(500 MB database, 1 GB storage, 5 GB egress, 500,000 Edge Function invocations
a month, 50,000 monthly active users).

There is **one Supabase project and no separate test database**, so the test
suite runs against live data (see `tests/README.md`). Most of these rules exist
to stop that from filling the project up.

## Tests and the live database

1. **Clean up what a test run creates.** Until this was fixed, 3,196 of 3,200
   orders on the live project were test orders (about 300 a day).
   `tests/globalSetup.ts` snapshots the QA orders before the run and, in
   teardown, removes the ones the run created with `delete_qa_orders()`
   (migrations 0082-0084). Do not create orders any other way that escapes this.
   The function only deletes orders of `is_test` merchants, and skips any order
   something else refers to (a wallet row, settlement, review, return, support
   ticket, settled payment, sold stock).
2. **Sign in once per run.** The QA accounts sign in in `globalSetup` and tests
   get the token from `signIn()` in `tests/env.ts` (cached). Every real sign-in
   leaves an auth session and refresh token nothing deletes: 3,253 had piled up
   on the four QA accounts. Use `signInFresh()` only when signing in is itself
   what the test is about.
3. **Delete the auth users a test creates, and check that it worked.** Use
   `deleteDisposableUser()` from `tests/helpers.ts`. `auth.admin.deleteUser()`
   fails silently for a customer who has orders (`orders.customer_id` is
   `ON DELETE RESTRICT`), which left 48 `qa-codfraud-*` accounts behind.
4. **QA fixtures must set `is_test = true`** (migration 0079). It hides them
   from customer pages and lets `delete_qa_orders()` recognize them. It does
   **not** stop data from accumulating; rule 1 does that.
5. **A test that reads a list must read all of it.** One response is capped at
   1,000 rows (`max_rows`), so a bare `.select()` on a big table silently reads
   a slice. `order-numbers.test.ts` "every order_number is unique" only ever
   checked the first 1,000 orders. Use `fetchAllRows()`.
6. **Do not blind a test by suppressing data.** In-app notifications to QA
   accounts are not skipped (the notification tests need them); they are removed
   by the teardown in rule 1 and by the retention job in rule 8.

## Database

7. **Audit only what a person did.** `log_config_change()` no longer logs
   service-role writes (no actor) to config tables, or changes to an `is_test`
   merchant (migration 0085): 98% of 5,001 audit rows had no actor, and
   `audit_logs` was the biggest public table (4.5 MB).
8. **Every table that only grows needs retention, and every `pg_cron` job needs
   its history pruned.** `prune_old_operational_rows()` runs daily at 03:17 UTC:
   `cron.job_run_details` older than 7 days (it had 20,034 rows; the
   per-minute job alone adds 1,440 a day), `audit_logs` older than 180 days, read
   `notifications` older than 90 days. A new log/history/outbox table adds its
   own line to that function in the same migration that creates it.
9. **Don't store what you can derive or don't need.** `delivery_jobs` keeps
   status only, not the request payload (the payload holds phone numbers and is
   rebuilt from the order on retry).
10. **Don't make an Edge Function call that is about to be told "skipped".**
    `order-status` checks `TOLO_DELIVERY_HANDOFF_ENABLED` itself before calling
    `delivery-handoff`; every call counts against 500,000 a month.

## Storage

11. **Compress images before upload.** `compressImage()` in `@tolo/ui`:
    logos at most 512 px / WebP / 100 KB (`LOGO_IMAGE_PRESET`), product images
    and banners at most 1600 px / WebP / 300 KB (`PRODUCT_IMAGE_PRESET`). One
    1.77 MB logo PNG was 94% of all storage. The `product-images` bucket now
    refuses files over 1 MB (migration 0086). Every new upload path goes through
    `compressImage()`; a bucket without a `file_size_limit` is a bug.

## Queries and lists

12. **Anything that can pass 1,000 rows is paged.** Lists use `.range()` with
    `usePagination`; aggregates and exports use `fetchAllRows()`; "rows for this
    list of ids" uses `fetchAllRowsForIds()` (an `.in()` list also goes in the URL,
    so hundreds of ids can make the request fail outright). Always `.order()` by a
    unique column when paging. Fixed in this round: both revenue charts, the admin
    customer order counts, settlement statements. Bounded by nature, so fine as
    is: a single order's items, one merchant's currently active orders, a
    settlement's adjustments.

## Migrations and live changes

13. **Back up before every live migration.** The free plan has no automatic
    backups. Use `pg_dump` (the Windows binaries zip from enterprisedb.com works
    where the installer is blocked; Docker is not installed here, so
    `supabase db dump` does not):
    `pg_dump -h aws-1-eu-west-1.pooler.supabase.com -p 5432 -U postgres.<project-ref> -d postgres --clean --if-exists --no-owner -n public -n auth -n storage -n supabase_migrations -f backup_<date>_<letter>.sql`
    with `PGPASSWORD` set for that one command. Check the file has real content
    (size, `COPY` block count, "PostgreSQL database dump complete"). `/backup*.sql`
    is gitignored. Never put the database password in a file or a commit.
14. **A migration that has been applied to live is not edited.** Fix forward with
    a new migration (0084 fixed 0083).
15. **Bulk deletes go through a function with per-row safety checks,** and run in
    chunks (200 rows) so one bad row or a statement timeout can't block the rest.

## Personal data

16. **Contact details never sit on a publicly readable row.** `merchants` is readable
    by anyone for an active merchant (the storefront embeds it), so a merchant's phone,
    email, owner name and registration number live in `merchant_private` (migration
    0099/0100), and the TIN in `merchant_tins` (0094), each with its own row-level security.
    A new sensitive field goes in one of those, never on `merchants`, `stores` or
    `products`. A test must show an anonymous request cannot read it.
17. **Deleting a person means anonymizing, and what an admin may do is enforced in the
    database.** Customers are anonymized (`admin_anonymize_customer`), merchants are
    closed or, with no history, deleted (`admin_close_merchant`,
    `admin_delete_merchant`): see `docs/admin-customer-merchant-management.md`. The
    admin dashboard hides the buttons staff may not use, but the functions and
    triggers refuse them too, and every edit, anonymize, close, reopen and delete
    writes `audit_logs` with phones and the TIN masked.
