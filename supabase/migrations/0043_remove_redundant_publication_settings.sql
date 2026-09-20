-- Removes product_publication_mode and merchant_features.auto_publish_products
-- (system_settings sweep): neither was ever read anywhere outside
-- Settings.tsx and their own seed rows (0012_platform_admin.sql,
-- 0026_admin_control_and_discounts_part2.sql). Both appear aimed at the
-- same "does a new product need approval before going live" question that's
-- already answered by the real, working mechanism: ProductForm.tsx checks
-- store.status === 'active' to decide between "published" and "submitted"
-- directly, with no involvement from either setting. Removing both outright
-- rather than wiring one up, since the real mechanism already works and
-- doesn't need a second, parallel one — same reasoning as migration 0039's
-- removal of the orphaned unacknowledged_order_escalation_minutes key.
--
-- Historical migrations that originally seeded these are left untouched
-- (an accurate record of what happened at the time, not living config) —
-- this migration only removes the live data, the same pattern 0039 used.
delete from system_settings where key = 'product_publication_mode';

update system_settings
set value = value - 'auto_publish_products'
where key = 'merchant_features';
