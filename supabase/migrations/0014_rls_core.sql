-- profiles
alter table profiles enable row level security;

create policy "profiles_select_own_or_staff" on profiles
  for select using (id = auth.uid() or is_tolo_staff());

create policy "profiles_update_own" on profiles
  for update using (id = auth.uid() or is_tolo_admin());

-- merchants
alter table merchants enable row level security;

create policy "merchants_select" on merchants
  for select using (owner_id = auth.uid() or is_merchant_member(id) or is_tolo_staff());

create policy "merchants_insert_application" on merchants
  for insert with check (owner_id = auth.uid() or is_tolo_staff());

create policy "merchants_update" on merchants
  for update using (owner_id = auth.uid() or is_tolo_staff());

-- merchant_documents
alter table merchant_documents enable row level security;

create policy "merchant_documents_select" on merchant_documents
  for select using (is_merchant_member(merchant_id) or is_tolo_staff());

create policy "merchant_documents_insert" on merchant_documents
  for insert with check (is_merchant_member(merchant_id) or is_tolo_staff());

-- merchant_staff
alter table merchant_staff enable row level security;

create policy "merchant_staff_select" on merchant_staff
  for select using (user_id = auth.uid() or is_merchant_member(merchant_id) or is_tolo_staff());

create policy "merchant_staff_manage" on merchant_staff
  for all using (
    exists (select 1 from merchants where id = merchant_id and owner_id = auth.uid())
    or is_tolo_staff()
  ) with check (
    exists (select 1 from merchants where id = merchant_id and owner_id = auth.uid())
    or is_tolo_staff()
  );

-- stores
alter table stores enable row level security;

create policy "stores_public_select_active" on stores
  for select using (status = 'active' or is_merchant_member(merchant_id) or is_tolo_staff());

create policy "stores_manage" on stores
  for all using (is_merchant_member(merchant_id) or is_tolo_staff())
  with check (is_merchant_member(merchant_id) or is_tolo_staff());

-- store_settings
alter table store_settings enable row level security;

create policy "store_settings_select" on store_settings
  for select using (
    exists (select 1 from stores where id = store_id and (is_merchant_member(merchant_id) or is_tolo_staff()))
  );

create policy "store_settings_manage" on store_settings
  for all using (
    exists (select 1 from stores where id = store_id and is_merchant_member(merchant_id))
    or is_tolo_staff()
  ) with check (
    exists (select 1 from stores where id = store_id and is_merchant_member(merchant_id))
    or is_tolo_staff()
  );

-- categories
alter table categories enable row level security;

create policy "categories_public_select" on categories
  for select using (is_active or is_tolo_staff());

create policy "categories_manage" on categories
  for all using (is_tolo_staff()) with check (is_tolo_staff());

-- products
alter table products enable row level security;

create policy "products_public_select_published" on products
  for select using (status = 'published' or is_merchant_member(merchant_id) or is_tolo_staff());

create policy "products_manage" on products
  for all using (is_merchant_member(merchant_id) or is_tolo_staff())
  with check (is_merchant_member(merchant_id) or is_tolo_staff());

-- product_variants
alter table product_variants enable row level security;

create policy "product_variants_select" on product_variants
  for select using (
    exists (select 1 from products where id = product_id and status = 'published')
    or is_merchant_member(merchant_id_for_variant(id))
    or is_tolo_staff()
  );

create policy "product_variants_manage" on product_variants
  for all using (is_merchant_member(merchant_id_for_product(product_id)) or is_tolo_staff())
  with check (is_merchant_member(merchant_id_for_product(product_id)) or is_tolo_staff());

-- product_images
alter table product_images enable row level security;

create policy "product_images_select" on product_images
  for select using (
    exists (select 1 from products where id = product_id and status = 'published')
    or is_merchant_member(merchant_id_for_product(product_id))
    or is_tolo_staff()
  );

create policy "product_images_manage" on product_images
  for all using (is_merchant_member(merchant_id_for_product(product_id)) or is_tolo_staff())
  with check (is_merchant_member(merchant_id_for_product(product_id)) or is_tolo_staff());

-- inventory
alter table inventory enable row level security;

create policy "inventory_select" on inventory
  for select using (is_merchant_member(merchant_id_for_variant(variant_id)) or is_tolo_staff());

create policy "inventory_manage" on inventory
  for all using (is_merchant_member(merchant_id_for_variant(variant_id)) or is_tolo_staff())
  with check (is_merchant_member(merchant_id_for_variant(variant_id)) or is_tolo_staff());

-- inventory_movements
alter table inventory_movements enable row level security;

create policy "inventory_movements_select" on inventory_movements
  for select using (is_merchant_member(merchant_id_for_variant(variant_id)) or is_tolo_staff());

create policy "inventory_movements_insert" on inventory_movements
  for insert with check (is_merchant_member(merchant_id_for_variant(variant_id)) or is_tolo_staff());
