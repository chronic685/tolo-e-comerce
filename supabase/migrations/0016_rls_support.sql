-- reviews
alter table reviews enable row level security;

create policy "reviews_public_select" on reviews
  for select using (true);

create policy "reviews_insert_own" on reviews
  for insert with check (
    customer_id = auth.uid()
    and order_owner_for_merchant_order(merchant_order_id) = auth.uid()
  );

create policy "reviews_manage_own" on reviews
  for update using (customer_id = auth.uid() or is_tolo_staff());

create policy "reviews_delete_own" on reviews
  for delete using (customer_id = auth.uid() or is_tolo_staff());

-- returns
alter table returns enable row level security;

create policy "returns_select" on returns
  for select using (
    customer_id = auth.uid()
    or is_merchant_member(merchant_id_for_merchant_order(merchant_order_id))
    or is_tolo_staff()
  );

create policy "returns_insert_own" on returns
  for insert with check (customer_id = auth.uid());

create policy "returns_update" on returns
  for update using (
    is_merchant_member(merchant_id_for_merchant_order(merchant_order_id)) or is_tolo_staff()
  );

-- refunds
alter table refunds enable row level security;

create policy "refunds_select" on refunds
  for select using (
    exists (
      select 1 from returns r where r.id = return_id
      and (r.customer_id = auth.uid() or is_merchant_member(merchant_id_for_merchant_order(r.merchant_order_id)))
    )
    or is_tolo_finance()
  );

create policy "refunds_manage_finance" on refunds
  for all using (is_tolo_finance()) with check (is_tolo_finance());

-- notifications
alter table notifications enable row level security;

create policy "notifications_select_own" on notifications
  for select using (user_id = auth.uid() or is_tolo_staff());

create policy "notifications_update_own" on notifications
  for update using (user_id = auth.uid());

-- support_tickets
alter table support_tickets enable row level security;

create policy "support_tickets_select" on support_tickets
  for select using (user_id = auth.uid() or is_tolo_staff());

create policy "support_tickets_insert_own" on support_tickets
  for insert with check (user_id = auth.uid());

create policy "support_tickets_update" on support_tickets
  for update using (user_id = auth.uid() or is_tolo_staff());

-- audit_logs (system-written; readable by admins only)
alter table audit_logs enable row level security;

create policy "audit_logs_select_admin" on audit_logs
  for select using (is_tolo_admin());

-- system_settings
alter table system_settings enable row level security;

create policy "system_settings_select_all" on system_settings
  for select using (true);

create policy "system_settings_manage_admin" on system_settings
  for all using (is_tolo_admin()) with check (is_tolo_admin());
