create type store_status as enum (
  'draft',
  'active',
  'paused',
  'suspended',
  'closed'
);

create table stores (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null unique references merchants(id) on delete cascade,
  name text not null,
  slug text not null unique,
  logo_url text,
  banner_url text,
  description text,
  operating_hours jsonb not null default '{}'::jsonb,
  status store_status not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger stores_set_updated_at
  before update on stores
  for each row execute function set_updated_at();

create table store_settings (
  store_id uuid primary key references stores(id) on delete cascade,
  delivery_settings jsonb not null default '{}'::jsonb,
  policies jsonb not null default '{}'::jsonb,
  auto_publish_products boolean not null default false,
  updated_at timestamptz not null default now()
);

create table categories (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid references categories(id) on delete set null,
  name text not null,
  slug text not null unique,
  image_url text,
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create index idx_stores_merchant on stores(merchant_id);
create index idx_categories_parent on categories(parent_id);
