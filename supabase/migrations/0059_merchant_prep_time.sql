-- Group 2, item 7: merchant prep time per shop, shown to customers as an
-- estimate on the storefront. A plain nullable column on `stores` --
-- null means "not set", shown as no estimate at all rather than a
-- misleading default. No RLS change needed: prep_time_minutes is covered
-- by the same stores_manage (merchant can update their own store) and
-- stores_public_select_active (customers can read an active store's row)
-- policies every other stores column already uses.
alter table stores add column prep_time_minutes int;

alter table stores add constraint stores_prep_time_minutes_positive
  check (prep_time_minutes is null or prep_time_minutes > 0);
