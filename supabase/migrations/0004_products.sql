create type product_status as enum (
  'draft',
  'submitted',
  'approved',
  'published',
  'paused',
  'archived'
);

create table products (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchants(id) on delete cascade,
  store_id uuid not null references stores(id) on delete cascade,
  category_id uuid references categories(id) on delete set null,
  name text not null,
  slug text not null,
  description text,
  base_price numeric(12,2) not null check (base_price >= 0),
  discount_price numeric(12,2) check (discount_price is null or discount_price >= 0),
  sku text,
  status product_status not null default 'draft',
  rejection_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, slug)
);

create trigger products_set_updated_at
  before update on products
  for each row execute function set_updated_at();

create table product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  sku text,
  attributes jsonb not null default '{}'::jsonb, -- e.g. {"size":"M","color":"Red"}
  price numeric(12,2) not null check (price >= 0),
  discount_price numeric(12,2) check (discount_price is null or discount_price >= 0),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger product_variants_set_updated_at
  before update on product_variants
  for each row execute function set_updated_at();

create table product_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  variant_id uuid references product_variants(id) on delete cascade,
  url text not null,
  sort_order int not null default 0,
  is_primary boolean not null default false
);

create index idx_products_merchant on products(merchant_id);
create index idx_products_store on products(store_id);
create index idx_products_category on products(category_id);
create index idx_products_status on products(status);
create index idx_product_variants_product on product_variants(product_id);
create index idx_product_images_product on product_images(product_id);
