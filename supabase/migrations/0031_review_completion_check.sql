-- Found while implementing the customer Review page (UI/UX spec C25:
-- "Backend validates that customer actually completed/received the order").
-- The existing reviews_insert_own policy checked ownership of the merchant
-- order but not its status, so a customer could review a product the moment
-- an order was placed, before it ever shipped.

drop policy if exists "reviews_insert_own" on reviews;
create policy "reviews_insert_own" on reviews
  for insert with check (
    customer_id = auth.uid()
    and order_owner_for_merchant_order(merchant_order_id) = auth.uid()
    and exists (
      select 1 from merchant_orders
      where id = merchant_order_id and status = 'completed'
    )
  );
