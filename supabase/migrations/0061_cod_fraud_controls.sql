-- Group 2, item 9: fraud controls -- a cash-on-delivery order limit for
-- new accounts (amount and count, admin-configurable). COD is the
-- easiest payment method to abuse (no upfront payment verification, so a
-- fake/throwaway account can order repeatedly with no real consequence
-- until a merchant discovers the no-show at the door) -- nothing
-- previously limited it.
--
-- One config place, mirroring every other admin-tunable limit in this
-- schema (rate_limits, referral_reward, scheduled_orders, ...).
insert into system_settings (key, value) values
  ('cod_fraud_controls', jsonb_build_object(
    'enabled', true,
    'new_account_age_days', 7,
    'max_cod_orders', 3,
    'max_cod_amount_etb', 2000
  ))
on conflict (key) do nothing;

-- Checked from checkout/index.ts, before create_order() ever reserves
-- stock -- same "reject before the expensive/money-moving call" treatment
-- already given to the payment_methods-enabled and rate-limit checks in
-- that function. Returns the limits alongside the verdict so the edge
-- function can build a clear, specific customer-facing message without a
-- second round trip.
--
-- "New account" = created within new_account_age_days. Once an account
-- ages past that, this stops applying to it entirely, regardless of how
-- many COD orders it already has. Counts ALL of the customer's past COD
-- payments (pending or verified) toward both limits -- even a still-
-- pending COD order already represents real fulfillment exposure for a
-- merchant, so it counts before any human ever confirms it.
create or replace function customer_cod_fraud_check(p_customer_id uuid)
returns table(allowed boolean, existing_cod_orders int, existing_cod_amount numeric, max_cod_orders int, max_cod_amount_etb numeric)
language plpgsql security definer set search_path = public
as $$
declare
  v_enabled boolean;
  v_age_days numeric;
  v_max_orders int;
  v_max_amount numeric;
  v_account_created timestamptz;
  v_is_new boolean;
  v_count int;
  v_amount numeric;
begin
  select
    coalesce((value ->> 'enabled')::boolean, false),
    coalesce((value ->> 'new_account_age_days')::numeric, 7),
    coalesce((value ->> 'max_cod_orders')::int, 3),
    coalesce((value ->> 'max_cod_amount_etb')::numeric, 2000)
  into v_enabled, v_age_days, v_max_orders, v_max_amount
  from system_settings where key = 'cod_fraud_controls';

  select p.created_at into v_account_created from profiles p where p.id = p_customer_id;
  v_is_new := v_enabled and v_account_created is not null and v_account_created > now() - (v_age_days || ' days')::interval;

  if not v_is_new then
    return query select true, 0, 0::numeric, v_max_orders, v_max_amount;
    return;
  end if;

  select count(*), coalesce(sum(p.amount), 0)
  into v_count, v_amount
  from payments p
  join orders o on o.id = p.order_id
  where o.customer_id = p_customer_id and p.provider = 'cash_on_delivery';

  return query select (v_count < v_max_orders and v_amount < v_max_amount), v_count, v_amount, v_max_orders, v_max_amount;
end;
$$;

revoke execute on function customer_cod_fraud_check(uuid) from public, anon, authenticated;
