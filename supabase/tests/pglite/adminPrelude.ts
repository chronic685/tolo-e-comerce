// Shared by the admin controls and the expand/contract tests: the slice of the commerce schema migrations 0099 and 0100 touch, at the columns
// they use, which the PGlite harness does not model (it only has the Tolo-app tables).
export const ADMIN_PRELUDE = /* sql */ `
alter table profiles add column username text, add column avatar_url text, add column referral_code text, add column suspension_reason text;
create type store_status as enum ('draft','active','paused','suspended','closed');
alter table merchants
  add column email text, add column owner_full_name text, add column owner_phone text, add column owner_email text,
  add column business_registration_number text, add column rejection_reason text, add column suspension_reason text,
  add column city text, add column sub_city text, add column woreda text, add column landmark text,
  add column latitude numeric, add column longitude numeric, add column is_test boolean not null default false;
create table audit_logs (
  id uuid primary key default gen_random_uuid(), actor_id uuid, action text not null, entity_type text not null,
  entity_id uuid, metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);
create table merchant_staff (merchant_id uuid not null references merchants(id) on delete cascade, user_id uuid not null references profiles(id) on delete cascade);
create function is_merchant_member(p_merchant_id uuid) returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from merchants where id = p_merchant_id and owner_id = auth.uid())
   or exists (select 1 from merchant_staff where merchant_id = p_merchant_id and user_id = auth.uid()) $$;
create function has_admin_page(p_keys text[]) returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from profiles where id = auth.uid() and account_status = 'active'
   and (admin_tier is not null or (role like 'tolo\\_%' and permissions ?| p_keys))) $$;
create policy merchants_select on merchants for select
  using (owner_id = auth.uid() or is_merchant_member(id) or has_admin_page(array['merchants','orders','support']));
create policy merchants_public_select_active on merchants for select using (status = 'active');
create policy merchants_update on merchants for update using (owner_id = auth.uid() or has_admin_page(array['merchants']));
create policy merchants_insert on merchants for insert with check (owner_id = auth.uid() or has_admin_page(array['merchants']));

create table stores (
  id uuid primary key default gen_random_uuid(), merchant_id uuid not null unique references merchants(id) on delete cascade,
  name text not null, slug text, logo_url text, banner_url text, description text, operating_hours jsonb not null default '{}'::jsonb,
  status store_status not null default 'active', pickup_address text, prep_time_minutes int, latitude numeric, longitude numeric,
  created_at timestamptz not null default now()
);
create table products (
  id uuid primary key default gen_random_uuid(), merchant_id uuid not null references merchants(id) on delete cascade,
  store_id uuid not null references stores(id) on delete cascade, name text not null, status text not null default 'draft'
);
create table product_images (id uuid primary key default gen_random_uuid(), product_id uuid not null references products(id) on delete cascade, url text not null);
create table merchant_documents (id uuid primary key default gen_random_uuid(), merchant_id uuid not null references merchants(id) on delete cascade, file_url text not null, created_at timestamptz not null default now());
create table merchant_wallets (merchant_id uuid primary key references merchants(id) on delete cascade, balance numeric not null default 0);
create table commission_rules (id uuid primary key default gen_random_uuid(), scope_type text not null, scope_id uuid, rate_percent numeric not null);
create table settlements (id uuid primary key default gen_random_uuid(), merchant_id uuid not null references merchants(id) on delete cascade, total_amount numeric not null default 0, status text not null default 'pending', created_at timestamptz not null default now());
create table wallet_transactions (id uuid primary key default gen_random_uuid(), merchant_id uuid not null references merchants(id) on delete cascade, amount numeric not null default 0);
create table financial_adjustments (id uuid primary key default gen_random_uuid(), merchant_id uuid not null references merchants(id));
create function merchants_avg_rating(m merchants) returns numeric language sql stable as $$ select 4.5::numeric $$;
create function merchants_review_count(m merchants) returns bigint language sql stable as $$ select 3::bigint $$;

create table addresses (
  id uuid primary key default gen_random_uuid(), customer_id uuid not null references profiles(id) on delete cascade,
  label text, recipient_name text not null, phone text, line1 text not null, line2 text, city text not null, region text,
  country text, is_default boolean not null default false, latitude numeric, longitude numeric, landmark text, sub_city text,
  created_at timestamptz not null default now()
);
create table orders (
  id uuid primary key default gen_random_uuid(), customer_id uuid not null references profiles(id) on delete restrict,
  address_id uuid not null references addresses(id) on delete restrict, order_number bigint, total numeric not null default 0,
  payment_status text not null default 'pending', created_at timestamptz not null default now()
);
create table merchant_orders (
  id uuid primary key default gen_random_uuid(), order_id uuid not null references orders(id) on delete cascade,
  merchant_id uuid not null references merchants(id) on delete restrict, status text not null default 'new',
  created_at timestamptz not null default now()
);
create table carts (id uuid primary key default gen_random_uuid(), customer_id uuid not null unique references profiles(id) on delete cascade);
create table cart_items (id uuid primary key default gen_random_uuid(), cart_id uuid not null references carts(id) on delete cascade, quantity int not null default 1);
create table customer_favorites (id uuid primary key default gen_random_uuid(), customer_id uuid not null references profiles(id) on delete cascade, product_id uuid, merchant_id uuid);
create table notifications (id uuid primary key default gen_random_uuid(), user_id uuid not null references profiles(id) on delete cascade);
create table returns (id uuid primary key default gen_random_uuid(), merchant_order_id uuid, customer_id uuid not null references profiles(id) on delete cascade, reason text not null default 'x', status text not null default 'requested', created_at timestamptz not null default now());
create table refunds (id uuid primary key default gen_random_uuid(), return_id uuid not null references returns(id) on delete cascade, amount numeric not null default 0, status text not null default 'pending', created_at timestamptz not null default now());
create table reviews (id uuid primary key default gen_random_uuid(), product_id uuid, customer_id uuid not null references profiles(id) on delete cascade, rating int not null default 5, comment text, created_at timestamptz not null default now());
`;
