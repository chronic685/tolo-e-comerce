-- Formal, order-linked dispute resolution: support_tickets could only ever
-- be a generic, order-disconnected complaint (user_id/subject/body/status
-- only, migration 0011). Adds a nullable link to the specific
-- merchant_order the complaint is about.
--
-- merchant_order_id, not order_id: an order can fan out into several
-- merchant_orders (one per merchant in a multi-vendor cart), each with its
-- own independent fulfillment status (merchant_order_status). "Item never
-- arrived" / "wrong item" are inherently about one merchant's portion of
-- the order, not the cart as a whole -- and OrderDetail.tsx already renders
-- everything per-merchant_order (the cancel button, the review widget), so
-- a per-merchant_order link matches how this schema and this page already
-- carve up an order, rather than introducing a coarser order_id link that
-- would need its own resolution logic to figure out which merchant a
-- complaint is actually about.
alter table support_tickets
  add column merchant_order_id uuid references merchant_orders(id) on delete set null;

-- RLS: a customer must only ever be able to link a ticket to their OWN
-- order. The existing support_tickets_insert_own policy only checked
-- user_id = auth.uid() -- true of the ticket itself, but says nothing
-- about whose merchant_order is being referenced. Reuses
-- order_owner_for_merchant_order(), the same helper order_owner-style RLS
-- policies already use elsewhere (migration 0013), rather than
-- reimplementing the ownership lookup here.
drop policy if exists "support_tickets_insert_own" on support_tickets;
create policy "support_tickets_insert_own" on support_tickets
  for insert with check (
    user_id = auth.uid()
    and (merchant_order_id is null or order_owner_for_merchant_order(merchant_order_id) = auth.uid())
  );
