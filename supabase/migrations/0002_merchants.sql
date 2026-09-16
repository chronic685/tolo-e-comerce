create type merchant_status as enum (
  'registered',
  'pending_verification',
  'under_review',
  'approved',
  'active',
  'suspended',
  'rejected',
  'closed'
);

create table merchants (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id) on delete restrict,
  business_name text not null,
  business_category text,
  phone text,
  email text,
  location text,
  business_registration_number text,
  status merchant_status not null default 'registered',
  agreement_accepted boolean not null default false,
  approved_at timestamptz,
  approved_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger merchants_set_updated_at
  before update on merchants
  for each row execute function set_updated_at();

create table merchant_documents (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchants(id) on delete cascade,
  doc_type text not null,
  file_url text not null,
  status text not null default 'pending',
  uploaded_at timestamptz not null default now()
);

create type merchant_staff_role as enum (
  'owner',
  'store_manager',
  'product_manager',
  'order_manager',
  'inventory_manager'
);

create table merchant_staff (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchants(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  role merchant_staff_role not null,
  created_at timestamptz not null default now(),
  unique (merchant_id, user_id)
);

create index idx_merchants_owner on merchants(owner_id);
create index idx_merchant_staff_user on merchant_staff(user_id);
create index idx_merchant_staff_merchant on merchant_staff(merchant_id);
