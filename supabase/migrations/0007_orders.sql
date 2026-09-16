create table addresses (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references profiles(id) on delete cascade,
  label text,
  recipient_name text not null,
  phone text not null,
  line1 text not null,
  line2 text,
  city text not null,
  region text,
  country text not null default 'ET',
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);

create index idx_addresses_customer on addresses(customer_id);

create type order_payment_status as enum (
  'pending',
  'paid',
  'failed',
  'refunded'
);

-- Master order: one per checkout, may fan out into several merchant_orders.
create table orders (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references profiles(id) on delete restrict,
  address_id uuid not null references addresses(id) on delete restrict,
  subtotal numeric(12,2) not null default 0,
  delivery_fee numeric(12,2) not null default 0,
  total numeric(12,2) not null default 0,
  payment_status order_payment_status not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger orders_set_updated_at
  before update on orders
  for each row execute function set_updated_at();

create type merchant_order_status as enum (
  'new',
  'accepted',
  'rejected',
  'processing',
  'ready_for_pickup',
  'picked_up',
  'delivered',
  'completed',
  'cancelled'
);

create table merchant_orders (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  merchant_id uuid not null references merchants(id) on delete restrict,
  status merchant_order_status not null default 'new',
  subtotal numeric(12,2) not null default 0,
  commission_rate_applied numeric(5,2) not null default 0,
  commission_amount numeric(12,2) not null default 0,
  merchant_payable numeric(12,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger merchant_orders_set_updated_at
  before update on merchant_orders
  for each row execute function set_updated_at();

create table order_items (
  id uuid primary key default gen_random_uuid(),
  merchant_order_id uuid not null references merchant_orders(id) on delete cascade,
  variant_id uuid not null references product_variants(id) on delete restrict,
  product_name_snapshot text not null,
  variant_attributes_snapshot jsonb not null default '{}'::jsonb,
  unit_price numeric(12,2) not null,
  quantity int not null check (quantity > 0),
  subtotal numeric(12,2) not null
);

create table order_status_history (
  id uuid primary key default gen_random_uuid(),
  merchant_order_id uuid not null references merchant_orders(id) on delete cascade,
  status merchant_order_status not null,
  changed_by uuid references profiles(id),
  note text,
  changed_at timestamptz not null default now()
);

create index idx_merchant_orders_order on merchant_orders(order_id);
create index idx_merchant_orders_merchant on merchant_orders(merchant_id);
create index idx_order_items_merchant_order on order_items(merchant_order_id);
create index idx_order_status_history_mo on order_status_history(merchant_order_id);
