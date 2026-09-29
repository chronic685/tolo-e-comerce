-- Group 1, item 5. Verified first (repo-wide grep + reading order-status/
-- index.ts's reject/cancelled branch): a merchant rejecting or cancelling
-- an order already releases the reserved stock, but never refunds the
-- customer even when the order was already paid (refunds only ever
-- happened for post-delivery `returns`, a table that structurally
-- requires a return_id — wrong fit for "never delivered, never should
-- have been charged"). And nothing at all auto-cancelled an order a
-- merchant simply never responded to -- escalate_unacknowledged_orders()
-- (migration 0033) only ever notified Tolo ops, forever, with no backstop
-- that actually resolves the order. Both are added here.
--
-- 1. Auto-refund on reject/cancel -------------------------------------
-- One shared function so the manual path (order-status/index.ts, via RPC)
-- and the new auto-cancel cron below can never drift out of sync on how a
-- refund gets created.
--
-- Reuses the EXISTING returns/refunds tables/RLS/admin UI (Refunds.tsx)
-- rather than inventing a second refund mechanism: a synthetic `returns`
-- row is opened already 'approved' (skipping 'requested'/'received' --
-- there's no physical item to return, since the order was never
-- delivered) so it plugs directly into the same Finance queue and the
-- same refunds_wallet_clawback trigger (migration 0034) a customer-
-- initiated return/refund already uses.
--
-- Refund amount is the rejected/cancelled merchant_order's own net
-- customer-facing charge (subtotal - discount_amount) -- correct
-- regardless of whether the cart had one merchant or several, since only
-- this merchant's line items are being refunded. Deliberately NOT
-- refunding a share of delivery_fee here: that's a single order-level
-- charge that only makes sense to reconsider once every merchant_order on
-- the order is known to be cancelled, which is exactly the kind of
-- judgment call the existing financial_adjustments/settlement-adjustments
-- mechanism exists for -- left to manual admin handling rather than
-- guessed at here.
--
-- Creates status='pending', never 'completed' -- nothing in this schema
-- has ever automated actually moving money for cash/bank/mobile-money
-- (see _shared/payment_providers.ts), so this is exactly as automated as
-- it can honestly be: the refund is opened immediately and correctly,
-- landing in the admin Refunds page's "Refunds" queue for Finance to
-- mark completed once the money is actually sent back.
create or replace function refund_merchant_order_if_paid(p_merchant_order_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_order_id uuid;
  v_customer_id uuid;
  v_payment_status order_payment_status;
  v_subtotal numeric;
  v_discount_amount numeric;
  v_refund_amount numeric;
  v_already_refunded int;
  v_return_id uuid;
begin
  select mo.order_id, mo.subtotal, coalesce(mo.discount_amount, 0), o.customer_id, o.payment_status
  into v_order_id, v_subtotal, v_discount_amount, v_customer_id, v_payment_status
  from merchant_orders mo
  join orders o on o.id = mo.order_id
  where mo.id = p_merchant_order_id;

  if not found or v_payment_status <> 'paid' then
    return;
  end if;

  -- Idempotency: this must be a no-op if called twice for the same
  -- merchant_order (e.g. a retried request) -- never double-refund.
  select count(*) into v_already_refunded
  from refunds f join returns r on r.id = f.return_id
  where r.merchant_order_id = p_merchant_order_id;
  if v_already_refunded > 0 then
    return;
  end if;

  v_refund_amount := greatest(v_subtotal - v_discount_amount, 0);
  if v_refund_amount <= 0 then
    return;
  end if;

  insert into returns (merchant_order_id, customer_id, reason, status)
  values (p_merchant_order_id, v_customer_id, p_reason, 'approved')
  returning id into v_return_id;

  insert into refunds (return_id, amount, status)
  values (v_return_id, v_refund_amount, 'pending');
end;
$$;

revoke execute on function refund_merchant_order_if_paid(uuid, text) from public, anon, authenticated;

-- 2. Auto-cancel timeout config, in one place --------------------------
-- Deliberately separate from merchant_new_order_alerts.escalate_after_minutes
-- (migration 0033/0026): that setting only ever pages Tolo ops so a human
-- can intervene, and stays independently tunable from this one, which
-- actually cancels the order and moves money. after_minutes defaults well
-- past a typical escalate_after_minutes (5) so ops gets a real chance to
-- reach the merchant before this fires.
insert into system_settings (key, value) values
  ('auto_cancel_unresponsive_orders', jsonb_build_object('enabled', true, 'after_minutes', 30))
on conflict (key) do nothing;

insert into notification_templates (event_type, title_template, body_template) values
  ('order_auto_cancelled', 'Order auto-cancelled — no response',
   'Order {{order_number}} was automatically cancelled because it was not acknowledged in time, and the customer has been refunded. Check your new-order alerts so this doesn''t happen again.')
on conflict (event_type, channel, language) do nothing;

-- 3. The cron job itself -------------------------------------------------
-- Same claim pattern as escalate_unacknowledged_orders() (migration 0033):
-- the UPDATE ... WHERE status = 'new' ... RETURNING is what makes this
-- safe under concurrent/repeated runs -- a merchant_order claimed by one
-- run can never be claimed again by another.
create or replace function auto_cancel_unresponsive_orders()
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  v_enabled boolean;
  v_after_minutes numeric;
  v_claimed record;
  v_item record;
  v_customer_id uuid;
  v_order_number bigint;
  v_merchant_name text;
  v_merchant_owner uuid;
  v_count integer := 0;
begin
  select coalesce((value ->> 'enabled')::boolean, false), coalesce((value ->> 'after_minutes')::numeric, 30)
  into v_enabled, v_after_minutes
  from system_settings where key = 'auto_cancel_unresponsive_orders';

  if not v_enabled or v_after_minutes is null or v_after_minutes <= 0 then
    return 0;
  end if;

  for v_claimed in
    update merchant_orders
    set status = 'rejected'
    where status = 'new'
      and order_received_at is null
      and notification_sent_at is not null
      and notification_sent_at <= now() - (v_after_minutes || ' minutes')::interval
      and (scheduled_for is null or scheduled_for <= now() + (v_after_minutes || ' minutes')::interval)
    returning id, order_id, merchant_id
  loop
    v_count := v_count + 1;

    insert into order_status_history (merchant_order_id, status, note)
    values (v_claimed.id, 'rejected', 'Automatically cancelled — merchant did not respond in time');

    -- Same stock-release a manual reject/cancel takes (order-status/
    -- index.ts) -- reserved, never sold, must go back.
    for v_item in select variant_id, quantity from order_items where merchant_order_id = v_claimed.id loop
      perform release_stock(v_item.variant_id, v_item.quantity, v_claimed.order_id, false);
    end loop;

    perform refund_merchant_order_if_paid(v_claimed.id, 'Automatically cancelled — merchant did not respond in time');

    -- Best-effort, isolated per order: one bad/unexpected failure here
    -- must not stop the loop from processing the remaining orders, and
    -- must never undo the cancellation/refund already committed above --
    -- same failure-isolation principle as escalate_unacknowledged_orders().
    begin
      select o.customer_id, o.order_number into v_customer_id, v_order_number from orders o where o.id = v_claimed.order_id;
      select business_name, owner_id into v_merchant_name, v_merchant_owner from merchants where id = v_claimed.merchant_id;

      insert into notifications (user_id, type, title, body)
      select
        v_customer_id,
        t.event_type,
        replace(t.title_template, '{{merchant_name}}', coalesce(v_merchant_name, 'the merchant')),
        replace(replace(t.body_template, '{{merchant_name}}', coalesce(v_merchant_name, 'the merchant')), '{{order_number}}', 'TL-' || v_order_number)
      from notification_templates t
      where t.event_type = 'order_rejected' and t.channel = 'in_app' and t.language = 'en' and t.enabled;

      if v_merchant_owner is not null then
        insert into notifications (user_id, type, title, body)
        select
          v_merchant_owner,
          t.event_type,
          t.title_template,
          replace(t.body_template, '{{order_number}}', 'TL-' || v_order_number)
        from notification_templates t
        where t.event_type = 'order_auto_cancelled' and t.channel = 'in_app' and t.language = 'en' and t.enabled;
      end if;
    exception when others then
      raise warning 'auto_cancel_unresponsive_orders: notification failed for merchant_order %: %', v_claimed.id, sqlerrm;
    end;
  end loop;

  return v_count;
end;
$$;

revoke execute on function auto_cancel_unresponsive_orders() from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'auto-cancel-unresponsive-orders';
select cron.schedule('auto-cancel-unresponsive-orders', '*/5 * * * *', $$select auto_cancel_unresponsive_orders();$$);
