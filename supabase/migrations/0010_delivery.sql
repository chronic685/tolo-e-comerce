create type delivery_status as enum (
  'pending',
  'assigned',
  'picked_up',
  'in_transit',
  'delivered',
  'failed'
);

create table deliveries (
  id uuid primary key default gen_random_uuid(),
  merchant_order_id uuid not null unique references merchant_orders(id) on delete cascade,
  driver_id uuid,
  status delivery_status not null default 'pending',
  fee numeric(10,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger deliveries_set_updated_at
  before update on deliveries
  for each row execute function set_updated_at();

create table delivery_tracking (
  id uuid primary key default gen_random_uuid(),
  delivery_id uuid not null references deliveries(id) on delete cascade,
  status delivery_status not null,
  location jsonb,
  note text,
  recorded_at timestamptz not null default now()
);

create index idx_delivery_tracking_delivery on delivery_tracking(delivery_id);
