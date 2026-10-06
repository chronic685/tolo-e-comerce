-- One button per order: the merchant accepts and starts preparing in one step.
--
-- 1. THE LEGAL TRANSITIONS, IN THE DATABASE. The order-status Edge Function already validates every move with the
-- service role, but merchants_orders' update policy lets any member of the merchant write any status straight
-- through the API, so "a merchant can only advance to the next legal step" was a convention, not a rule. This
-- trigger makes it one for every client write. Edge Functions, cron jobs, the delivery callback and migrations
-- run as the service role (auth.uid() is null) and are not limited; Tolo admin tier is not either.
--
--   merchant (a member of the order's merchant):
--     new               -> processing   (accept and start preparing, the one-button path)
--                          accepted     (older two-step path, kept for existing clients and data)
--                          rejected
--     accepted          -> processing, cancelled
--     processing        -> ready_for_pickup, cancelled
--     ready_for_pickup  -> picked_up    (handed to the driver, or collected by the customer), cancelled
--   customer (the order's owner):
--     new | accepted | processing | ready_for_pickup -> cancelled
--
-- picked_up, delivered and completed are driven by the driver and the delivery handoff, so a merchant cannot
-- jump to them, and nobody on the client side can move an order backwards. The status values themselves are
-- unchanged: 'accepted' stays in the enum for existing orders and for the delivery handoff and Tolo-app
-- contracts, which are untouched.
create or replace function merchant_order_transition_ok(p_from merchant_order_status, p_to merchant_order_status)
returns boolean
language sql immutable
as $$
  select (p_from, p_to) in (
    ('new', 'processing'), ('new', 'accepted'), ('new', 'rejected'),
    ('accepted', 'processing'), ('accepted', 'cancelled'),
    ('processing', 'ready_for_pickup'), ('processing', 'cancelled'),
    ('ready_for_pickup', 'picked_up'), ('ready_for_pickup', 'cancelled')
  );
$$;

revoke execute on function merchant_order_transition_ok(merchant_order_status, merchant_order_status) from public, anon, authenticated;

create or replace function trg_enforce_merchant_order_transitions()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.status is not distinct from old.status then
    return new;
  end if;
  if auth.uid() is null or is_tolo_admin() then
    return new;
  end if;

  if is_merchant_member(old.merchant_id) and merchant_order_transition_ok(old.status, new.status) then
    return new;
  end if;

  if order_owner_for_merchant_order(old.id) = auth.uid()
     and new.status = 'cancelled' and old.status in ('new', 'accepted', 'processing', 'ready_for_pickup') then
    return new;
  end if;

  raise exception 'That order status change is not allowed.';
end;
$$;

revoke execute on function trg_enforce_merchant_order_transitions() from public, anon, authenticated;

create trigger merchant_orders_enforce_transitions
  before update of status on merchant_orders
  for each row execute function trg_enforce_merchant_order_transitions();

-- 2. ONE MESSAGE FOR ACCEPT + PREPARE. Accepting now takes an order straight to 'processing', so the customer gets a
-- single "accepted and being prepared" message instead of "received" and then "preparing" seconds apart. The two older
-- templates stay for orders moved the older two-step way.
insert into notification_templates (event_type, title_template, body_template) values
  ('order_accepted_preparing', 'Order accepted', 'Your order {{order_number}} was accepted and is being prepared.')
on conflict (event_type, channel, language) do nothing;
