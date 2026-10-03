-- Root cause: "QA TEST Store -- DO NOT USE" (merchants.business_name
-- "QA TEST -- Merchant A -- DO NOT USE") was publicly visible on the
-- customer Shops/Marketplace pages. It was not bypassing any
-- visibility/published flag -- there wasn't one. tests/fixtures/
-- ensureQaFixtures.ts (see tests/README.md -- this project has no
-- separate test database, so the test suite seeds a permanent, reused
-- fixture directly into the one live project) deliberately sets
-- status = 'active' on the merchant and store, and status = 'published'
-- on its products, because the suite needs them to behave exactly like a
-- real, approved merchant for authorization/tenant-isolation tests. Every
-- customer-facing query (BrowseShops.tsx, Storefront.tsx, Marketplace.tsx)
-- only ever filtered on those same status values, so the fixture was
-- indistinguishable from a real listing.
--
-- This adds an explicit is_test flag, independent of status, so the
-- fixture can keep looking "active/approved" to everything that needs
-- that (checkout, RLS, authorization tests) while customer-facing
-- discovery surfaces can exclude it specifically.
-- "if not exists": this column was first applied to the live project with a
-- targeted `supabase db query` (the project was still on migration 0068 and
-- a full `db push` of 0069-0078 was out of scope for the fix), so a later
-- `db push` must not fail on it.
alter table merchants add column if not exists is_test boolean not null default false;

comment on column merchants.is_test is
  'True for QA/CI fixture merchants (see tests/fixtures/ensureQaFixtures.ts). '
  'Never set for a real merchant. Customer-facing discovery surfaces '
  '(BrowseShops, Storefront, Marketplace) exclude is_test = true merchants '
  'even when status makes them otherwise look active/approved.';

-- Backfill the fixture merchants already live in this project (both
-- Merchant A and Merchant B from ensureQaFixtures.ts).
update merchants set is_test = true where business_name like 'QA TEST %DO NOT USE%';
