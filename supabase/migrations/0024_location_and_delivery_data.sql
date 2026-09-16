-- Location-aware checkout and delivery (spec: "Customer Registration,
-- Automatic Location & Delivery Information"). Core rule: never ask for
-- information the system already has (spec section 16).

-- Customer phone lives on the account, not re-typed at checkout.
alter table profiles
  add column phone_verified boolean not null default false;

-- Saved/delivery addresses gain real coordinates, captured via device GPS
-- rather than typed — exact coordinates are what actually matters for
-- delivery, the text fields are just a human-readable label for the customer.
alter table addresses
  add column latitude numeric(9,6),
  add column longitude numeric(9,6),
  add column landmark text,
  add column sub_city text;

-- Store's own GPS location becomes the default pickup point for every order
-- from that store (spec section 14) — separate from the merchant's
-- registration address, since a merchant could relocate their store.
alter table stores
  add column latitude numeric(9,6),
  add column longitude numeric(9,6),
  add column pickup_address text;

-- Lightweight driver registry: Tolo's existing delivery system is the
-- source of truth for drivers (per the platform's delivery integration
-- principle); this table is just what the e-commerce side needs to display
-- who's assigned, not a full driver-management system.
create table drivers (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  phone text not null,
  vehicle_type text,
  vehicle_plate text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table drivers enable row level security;

create policy "drivers_select_tolo" on drivers
  for select using (is_tolo_staff());

create policy "drivers_manage_tolo" on drivers
  for all using (is_tolo_staff()) with check (is_tolo_staff());

-- Deliveries become self-contained: pickup/dropoff coordinates and the
-- sender/recipient contact are captured at delivery-creation time from the
-- store and order records, so drivers and Tolo ops never need to look those
-- up separately (spec section 12).
alter table deliveries
  add column pickup_latitude numeric(9,6),
  add column pickup_longitude numeric(9,6),
  add column pickup_address text,
  add column pickup_contact_name text,
  add column pickup_contact_phone text,
  add column dropoff_latitude numeric(9,6),
  add column dropoff_longitude numeric(9,6),
  add column dropoff_address text,
  add column dropoff_contact_name text,
  add column dropoff_contact_phone text;

alter table deliveries
  add constraint deliveries_driver_id_fkey foreign key (driver_id) references drivers(id);

create policy "drivers_select_assigned" on drivers
  for select using (
    exists (
      select 1 from deliveries d
      join merchant_orders mo on mo.id = d.merchant_order_id
      where d.driver_id = drivers.id
      and (is_merchant_member(mo.merchant_id) or order_owner_for_merchant_order(mo.id) = auth.uid())
    )
  );
