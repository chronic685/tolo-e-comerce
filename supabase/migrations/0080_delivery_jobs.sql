-- Delivery jobs: the marketplace's record of a delivery handed off to the Tolo
-- Delivery app's driver side (contract: docs/integration/delivery-handoff.md).
--
-- One job per merchant_order (a multi-merchant checkout has one pickup per
-- merchant, so one job each). The unique constraint is also what makes the
-- handoff idempotent: marking an order ready twice can never create two jobs.
--
-- This sits beside `deliveries` (0010/0024), which the order-status function
-- still opens at ready_for_pickup for the admin Deliveries page; it is not a
-- replacement. apply_delivery_job_update() keeps deliveries.status in step.
create type delivery_job_status as enum ('invoked', 'accepted', 'picked_up', 'delivered', 'failed');

create table delivery_jobs (
  id uuid primary key default gen_random_uuid(),
  merchant_order_id uuid not null unique references merchant_orders(id) on delete cascade,
  status delivery_job_status not null default 'invoked',
  -- Opaque reference to the driver, as the Tolo Delivery app sends it once
  -- one accepts. No name/phone: Tolo's system is the source of truth for drivers.
  driver_ref text,
  -- When the Tolo Delivery app expects to deliver, if it said so.
  eta_at timestamptz,
  failure_reason text,
  -- When the Tolo Delivery app acknowledged receiving the job; null until it
  -- does, so a failed/unreachable handoff is retryable.
  dispatched_at timestamptz,
  handoff_attempts int not null default 0,
  -- Short machine-readable reason the last handoff attempt failed (never a
  -- response body, key or phone).
  handoff_error text,
  invoked_at timestamptz not null default now(),
  accepted_at timestamptz,
  picked_up_at timestamptz,
  delivered_at timestamptz,
  failed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger delivery_jobs_set_updated_at
  before update on delivery_jobs
  for each row execute function set_updated_at();

alter table delivery_jobs enable row level security;

-- Read-only for everyone who may read: the customer who owns the order, the
-- merchant (owner/staff) it belongs to, and admins. Same shape as
-- deliveries_select (0051). No insert/update/delete policy exists, and the
-- grants are revoked too, so only the service role (the handoff and callback
-- Edge Functions) ever writes.
create policy delivery_jobs_select on delivery_jobs
  for select using (
    order_owner_for_merchant_order(merchant_order_id) = auth.uid()
    or is_merchant_member(merchant_id_for_merchant_order(merchant_order_id))
    or has_admin_page(array['delivery_ops'])
  );

revoke all on delivery_jobs from anon;
revoke insert, update, delete, truncate on delivery_jobs from authenticated;

-- Applies a status update the Tolo Delivery app sent (delivery-status-callback)
-- to the job and mirrors it onto the order the customer sees, in one
-- transaction. Updates only move forward (invoked -> accepted -> picked_up ->
-- delivered); `failed` can come from any non-final state; a repeat of the
-- current status is a harmless no-op (the Tolo side may retry callbacks).
-- Raises a bare error code the Edge Function maps to an HTTP status:
--   job_not_found, invalid_status, invalid_transition, driver_ref_required
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

  if v_job.status in ('delivered', 'failed') then
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

revoke execute on function apply_delivery_job_update(uuid, delivery_job_status, text, int, text) from public, anon, authenticated;
grant execute on function apply_delivery_job_update(uuid, delivery_job_status, text, int, text) to service_role;
