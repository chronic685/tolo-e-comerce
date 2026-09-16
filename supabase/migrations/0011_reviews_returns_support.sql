create table reviews (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  customer_id uuid not null references profiles(id) on delete cascade,
  merchant_order_id uuid not null references merchant_orders(id) on delete cascade,
  rating int not null check (rating between 1 and 5),
  comment text,
  created_at timestamptz not null default now(),
  unique (merchant_order_id, product_id)
);

create type return_status as enum (
  'requested',
  'approved',
  'rejected',
  'received',
  'completed'
);

create table returns (
  id uuid primary key default gen_random_uuid(),
  merchant_order_id uuid not null references merchant_orders(id) on delete cascade,
  customer_id uuid not null references profiles(id) on delete cascade,
  reason text not null,
  status return_status not null default 'requested',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger returns_set_updated_at
  before update on returns
  for each row execute function set_updated_at();

create type refund_status as enum (
  'pending',
  'processing',
  'completed',
  'failed'
);

create table refunds (
  id uuid primary key default gen_random_uuid(),
  return_id uuid not null references returns(id) on delete cascade,
  amount numeric(12,2) not null,
  status refund_status not null default 'pending',
  processed_at timestamptz,
  created_at timestamptz not null default now()
);

create table notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  type text not null,
  title text not null,
  body text,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

create index idx_notifications_user on notifications(user_id, is_read);

create table support_tickets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  subject text not null,
  body text,
  status text not null default 'open',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger support_tickets_set_updated_at
  before update on support_tickets
  for each row execute function set_updated_at();

create index idx_reviews_product on reviews(product_id);
create index idx_returns_merchant_order on returns(merchant_order_id);
