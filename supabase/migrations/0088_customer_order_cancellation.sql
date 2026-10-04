-- Customer order cancellation, any time before the driver has the parcel.
--
-- 1. delivery_jobs / deliveries get a 'cancelled' state. A job the marketplace
--    cancels (the customer cancelled the order) is final: a late callback from
--    the Tolo Delivery app is refused with invalid_transition, like one for a
--    delivered or failed job. (ADD VALUE is only referenced from plpgsql
--    bodies below, never in this transaction.)
alter type delivery_job_status add value if not exists 'cancelled';
alter type delivery_status add value if not exists 'cancelled';
alter table delivery_jobs add column cancelled_at timestamptz;

-- Same function as 0080, with 'cancelled' added to the final states so a late
-- failed/picked_up callback cannot move a cancelled job.
create or replace function apply_delivery_job_update(
  p_job_id uuid,
  p_status delivery_job_status,
  p_driver_ref text default null,
  p_eta_minutes int default null,
  p_failure_reason text default null
)
returns table (outcome text, merchant_order_id uuid)
language plpgsql security definer set search_path = public
as $$
declare
  v_job delivery_jobs;
  v_driver text;
  v_eta timestamptz;
  v_changed boolean;
  v_delivery_status delivery_status;
begin
  if p_status = 'invoked' then
    raise exception 'invalid_status';
  end if;

  select * into v_job from delivery_jobs where id = p_job_id for update;
  if not found then
    raise exception 'job_not_found';
  end if;

  if v_job.status in ('delivered', 'failed', 'cancelled') then
    if p_status = v_job.status then
      return query select 'unchanged'::text, v_job.merchant_order_id;
      return;
    end if;
    raise exception 'invalid_transition';
  end if;

  if p_status <> 'failed' and p_status <> v_job.status then
    if array_position(enum_range(null::delivery_job_status), p_status)
       < array_position(enum_range(null::delivery_job_status), v_job.status) then
      raise exception 'invalid_transition';
    end if;
  end if;

  v_driver := coalesce(nullif(btrim(p_driver_ref), ''), v_job.driver_ref);
  if p_status in ('accepted', 'picked_up', 'delivered') and v_driver is null then
    raise exception 'driver_ref_required';
  end if;

  v_eta := case
    when p_status in ('delivered', 'failed') then null
    when p_eta_minutes is not null then now() + make_interval(mins => p_eta_minutes)
    else v_job.eta_at
  end;

  v_changed := p_status <> v_job.status
    or v_driver is distinct from v_job.driver_ref
    or p_eta_minutes is not null;
  if not v_changed then
    return query select 'unchanged'::text, v_job.merchant_order_id;
    return;
  end if;

  update delivery_jobs set
    status = p_status,
    driver_ref = v_driver,
    eta_at = v_eta,
    failure_reason = case when p_status = 'failed' then nullif(btrim(p_failure_reason), '') else failure_reason end,
    accepted_at = case when p_status = 'accepted' and accepted_at is null then now() else accepted_at end,
    picked_up_at = case when p_status = 'picked_up' and picked_up_at is null then now() else picked_up_at end,
    delivered_at = case when p_status = 'delivered' then now() else delivered_at end,
    failed_at = case when p_status = 'failed' then now() else failed_at end
  where id = v_job.id;

  if p_status <> v_job.status then
    -- Keep the admin Deliveries page's record (deliveries) in step.
    v_delivery_status := case p_status
      when 'accepted' then 'assigned'
      when 'picked_up' then 'picked_up'
      when 'delivered' then 'delivered'
      else 'failed'
    end;
    update deliveries set status = v_delivery_status where deliveries.merchant_order_id = v_job.merchant_order_id;

    -- The order the customer sees. Only moves an order that is still in the
    -- delivery leg, so a late callback can't resurrect a cancelled order.
    -- `failed` leaves the order where it is: Tolo ops/the merchant sort it out.
    if p_status = 'picked_up' then
      update merchant_orders set status = 'picked_up'
        where id = v_job.merchant_order_id and status = 'ready_for_pickup';
      if found then
        insert into order_status_history (merchant_order_id, status, note)
        values (v_job.merchant_order_id, 'picked_up', 'Delivery status: picked_up');
      end if;
    elsif p_status = 'delivered' then
      update merchant_orders set status = 'delivered'
        where id = v_job.merchant_order_id and status in ('ready_for_pickup', 'picked_up');
      if found then
        insert into order_status_history (merchant_order_id, status, note)
        values (v_job.merchant_order_id, 'delivered', 'Delivery status: delivered');
        -- Same auto-completion delivery-dispatch applies on delivery.
        update merchant_orders set status = 'completed' where id = v_job.merchant_order_id;
        insert into order_status_history (merchant_order_id, status, note)
        values (v_job.merchant_order_id, 'completed', 'Auto-completed after delivery confirmation');
      end if;
    end if;
  end if;

  return query select 'applied'::text, v_job.merchant_order_id;
end;
$$;

-- 2. One place that undoes a cancelled/rejected merchant order's fulfilment
--    state: its stock and its delivery records. Called by order-status.
--
-- Stock: what checkout reserved is only turned into a sale when payment is
-- confirmed (finalizePaymentSuccess). So an unpaid order gives the
-- reservation back (release_stock), and a PAID order -- whose reservation was
-- already consumed -- puts the sold units back on the shelf. The old
-- order-status loop called release_stock(false) for both, which for a paid
-- order took reserved_quantity down a second time (corrupting other orders'
-- reservations, or failing the check constraint at 0). Items already removed
-- at fulfilment (0065) gave their stock back when they were removed, so they
-- are skipped. The release is clamped to what is actually reserved, as in 0084.
--
-- Delivery: an 'invoked' or 'accepted' job (nobody has the parcel yet) and its
-- deliveries row are marked cancelled. A picked_up/delivered job is left alone;
-- order-status refuses to cancel those before ever calling this.
create or replace function cancel_order_fulfilment(p_merchant_order_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_order_id uuid;
  v_paid boolean;
  v_item record;
  v_reserved int;
begin
  select mo.order_id, o.payment_status = 'paid'
  into v_order_id, v_paid
  from merchant_orders mo join orders o on o.id = mo.order_id
  where mo.id = p_merchant_order_id;
  if not found then
    raise exception 'merchant_order_not_found';
  end if;

  for v_item in
    select variant_id, quantity from order_items
    where merchant_order_id = p_merchant_order_id and item_status <> 'removed'
  loop
    if v_paid then
      perform set_config('app.bypass_listing_check', 'true', true);
      update inventory set stock_quantity = stock_quantity + v_item.quantity where variant_id = v_item.variant_id;
      insert into inventory_movements (variant_id, movement_type, quantity, reference_type, reference_id)
      values (v_item.variant_id, 'restock', v_item.quantity, 'order_cancellation', v_order_id);
    else
      select reserved_quantity into v_reserved from inventory where variant_id = v_item.variant_id;
      if coalesce(v_reserved, 0) > 0 then
        perform release_stock(v_item.variant_id, least(v_item.quantity, v_reserved), v_order_id, false);
      end if;
    end if;
  end loop;

  update delivery_jobs
  set status = 'cancelled', cancelled_at = now(), eta_at = null
  where merchant_order_id = p_merchant_order_id and status in ('invoked', 'accepted');

  update deliveries set status = 'cancelled'
  where merchant_order_id = p_merchant_order_id and status in ('pending', 'assigned');
end;
$$;

revoke execute on function cancel_order_fulfilment(uuid) from public, anon, authenticated;
grant execute on function cancel_order_fulfilment(uuid) to service_role;

-- 3. Merchant-facing notice that the customer cancelled.
insert into notification_templates (event_type, title_template, body_template) values
  ('order_cancelled_by_customer', 'Order cancelled by customer',
   'Order {{order_number}} was cancelled by the customer. If it was already paid, a refund has been opened.')
on conflict (event_type, channel, language) do nothing;
