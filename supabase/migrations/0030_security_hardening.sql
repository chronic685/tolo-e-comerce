-- Fixes 4 confirmed gaps against the Permissions & Security Matrix, found by
-- checking the live implementation rather than assuming it already matched:
--
--   1. merchant_staff.role (owner/store_manager/product_manager/
--      order_manager/inventory_manager) was stored but never read — every
--      staff member had owner-level access to wallet balance, settlements,
--      and business documents via the blanket is_merchant_member() check.
--   2. Merchant approve/reject/suspend wrote a notification but never an
--      audit_logs row, unlike every other sensitive admin action.
--   3. Storage buckets had no MIME-type or size limits — only a client-side
--      <input accept> filter, which is not a real control.
--
-- (The 4th fix — checkout no longer leaking raw DB error text — is a
-- TypeScript change in supabase/functions/checkout/index.ts, not SQL.)

-- 1. Merchant staff: financial/document visibility narrowed to
-- owner + store_manager, matching "Staff should not see sensitive
-- financial information unless explicitly permitted" and "Manager should
-- not automatically receive commission.update" (product/order/inventory
-- staff keep their existing operational access — nothing there narrows).

create or replace function is_merchant_owner_or_store_manager(p_merchant_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from merchants where id = p_merchant_id and owner_id = auth.uid()
  ) or exists (
    select 1 from merchant_staff
    where merchant_id = p_merchant_id and user_id = auth.uid() and role = 'store_manager'
  );
$$;

drop policy if exists "merchant_wallets_select" on merchant_wallets;
create policy "merchant_wallets_select" on merchant_wallets
  for select using (is_merchant_owner_or_store_manager(merchant_id) or is_tolo_finance());

drop policy if exists "wallet_transactions_select" on wallet_transactions;
create policy "wallet_transactions_select" on wallet_transactions
  for select using (is_merchant_owner_or_store_manager(merchant_id) or is_tolo_finance());

drop policy if exists "settlements_select" on settlements;
create policy "settlements_select" on settlements
  for select using (is_merchant_owner_or_store_manager(merchant_id) or is_tolo_finance());

drop policy if exists "settlement_items_select" on settlement_items;
create policy "settlement_items_select" on settlement_items
  for select using (
    exists (select 1 from settlements where id = settlement_id and (is_merchant_owner_or_store_manager(merchant_id) or is_tolo_finance()))
  );

drop policy if exists "merchant_documents_select" on merchant_documents;
create policy "merchant_documents_select" on merchant_documents
  for select using (is_merchant_owner_or_store_manager(merchant_id) or is_tolo_staff());

drop policy if exists "merchant_documents_storage_select" on storage.objects;
create policy "merchant_documents_storage_select" on storage.objects
  for select using (
    bucket_id = 'merchant-documents'
    and (is_merchant_owner_or_store_manager((storage.foldername(name))[1]::uuid) or is_tolo_staff())
  );

drop policy if exists "financial_adjustments_select" on financial_adjustments;
create policy "financial_adjustments_select" on financial_adjustments
  for select using (is_merchant_owner_or_store_manager(merchant_id) or is_tolo_finance());

-- 2. Merchant status changes now audited like every other sensitive action.

create trigger merchants_log_change
  after update on merchants
  for each row execute function log_config_change();

-- 3. Storage: real server-side upload constraints, not just a client filter.

update storage.buckets
set file_size_limit = 10485760, -- 10 MB
    allowed_mime_types = array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
where id = 'merchant-documents';

update storage.buckets
set file_size_limit = 5242880, -- 5 MB
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
where id = 'product-images';
