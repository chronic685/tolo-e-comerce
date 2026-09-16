-- carts
alter table carts enable row level security;

create policy "carts_own" on carts
  for all using (customer_id = auth.uid()) with check (customer_id = auth.uid());

-- cart_items
alter table cart_items enable row level security;

create policy "cart_items_own" on cart_items
  for all using (
    exists (select 1 from carts where id = cart_id and customer_id = auth.uid())
  ) with check (
    exists (select 1 from carts where id = cart_id and customer_id = auth.uid())
  );

-- addresses
alter table addresses enable row level security;

create policy "addresses_own" on addresses
  for all using (customer_id = auth.uid() or is_tolo_staff())
  with check (customer_id = auth.uid());

-- orders (master order)
alter table orders enable row level security;

create policy "orders_select" on orders
  for select using (customer_id = auth.uid() or is_tolo_staff());

create policy "orders_insert_own" on orders
  for insert with check (customer_id = auth.uid());

create policy "orders_update_tolo" on orders
  for update using (is_tolo_staff());

-- merchant_orders
alter table merchant_orders enable row level security;

create policy "merchant_orders_select" on merchant_orders
  for select using (
    is_merchant_member(merchant_id)
    or order_owner(order_id) = auth.uid()
    or is_tolo_staff()
  );

create policy "merchant_orders_update" on merchant_orders
  for update using (is_merchant_member(merchant_id) or is_tolo_staff());

create policy "merchant_orders_insert" on merchant_orders
  for insert with check (order_owner(order_id) = auth.uid() or is_tolo_staff());

-- order_items
alter table order_items enable row level security;

create policy "order_items_select" on order_items
  for select using (
    is_merchant_member(merchant_id_for_merchant_order(merchant_order_id))
    or order_owner_for_merchant_order(merchant_order_id) = auth.uid()
    or is_tolo_staff()
  );

create policy "order_items_insert" on order_items
  for insert with check (
    order_owner_for_merchant_order(merchant_order_id) = auth.uid() or is_tolo_staff()
  );

-- order_status_history
alter table order_status_history enable row level security;

create policy "order_status_history_select" on order_status_history
  for select using (
    is_merchant_member(merchant_id_for_merchant_order(merchant_order_id))
    or order_owner_for_merchant_order(merchant_order_id) = auth.uid()
    or is_tolo_staff()
  );

create policy "order_status_history_insert" on order_status_history
  for insert with check (
    is_merchant_member(merchant_id_for_merchant_order(merchant_order_id)) or is_tolo_staff()
  );

-- payments
alter table payments enable row level security;

create policy "payments_select" on payments
  for select using (order_owner(order_id) = auth.uid() or is_tolo_finance());

create policy "payments_insert_own" on payments
  for insert with check (order_owner(order_id) = auth.uid() or is_tolo_finance());

create policy "payments_update_finance" on payments
  for update using (is_tolo_finance());

-- payment_transactions
alter table payment_transactions enable row level security;

create policy "payment_transactions_select" on payment_transactions
  for select using (
    exists (select 1 from payments where id = payment_id and order_owner(order_id) = auth.uid())
    or is_tolo_finance()
  );

create policy "payment_transactions_manage_finance" on payment_transactions
  for all using (is_tolo_finance()) with check (is_tolo_finance());

-- merchant_wallets
alter table merchant_wallets enable row level security;

create policy "merchant_wallets_select" on merchant_wallets
  for select using (is_merchant_member(merchant_id) or is_tolo_finance());

-- wallet_transactions (writes only via post_wallet_transaction(), which is security definer)
alter table wallet_transactions enable row level security;

create policy "wallet_transactions_select" on wallet_transactions
  for select using (is_merchant_member(merchant_id) or is_tolo_finance());

-- commission_rules
alter table commission_rules enable row level security;

create policy "commission_rules_manage" on commission_rules
  for all using (is_tolo_finance()) with check (is_tolo_finance());

-- settlements
alter table settlements enable row level security;

create policy "settlements_select" on settlements
  for select using (is_merchant_member(merchant_id) or is_tolo_finance());

create policy "settlements_manage_finance" on settlements
  for all using (is_tolo_finance()) with check (is_tolo_finance());

-- settlement_items
alter table settlement_items enable row level security;

create policy "settlement_items_select" on settlement_items
  for select using (
    exists (select 1 from settlements where id = settlement_id and (is_merchant_member(merchant_id) or is_tolo_finance()))
  );

create policy "settlement_items_manage_finance" on settlement_items
  for all using (is_tolo_finance()) with check (is_tolo_finance());

-- deliveries
alter table deliveries enable row level security;

create policy "deliveries_select" on deliveries
  for select using (
    is_merchant_member(merchant_id_for_merchant_order(merchant_order_id))
    or order_owner_for_merchant_order(merchant_order_id) = auth.uid()
    or is_tolo_staff()
  );

create policy "deliveries_manage_tolo" on deliveries
  for all using (is_tolo_staff()) with check (is_tolo_staff());

-- delivery_tracking
alter table delivery_tracking enable row level security;

create policy "delivery_tracking_select" on delivery_tracking
  for select using (
    exists (
      select 1 from deliveries d
      where d.id = delivery_id
      and (
        is_merchant_member(merchant_id_for_merchant_order(d.merchant_order_id))
        or order_owner_for_merchant_order(d.merchant_order_id) = auth.uid()
        or is_tolo_staff()
      )
    )
  );

create policy "delivery_tracking_manage_tolo" on delivery_tracking
  for all using (is_tolo_staff()) with check (is_tolo_staff());
