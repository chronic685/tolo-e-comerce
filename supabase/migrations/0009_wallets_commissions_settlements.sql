create table merchant_wallets (
  merchant_id uuid primary key references merchants(id) on delete cascade,
  balance numeric(14,2) not null default 0,
  updated_at timestamptz not null default now()
);

create type wallet_txn_type as enum (
  'sale',
  'commission',
  'refund',
  'adjustment',
  'settlement'
);

-- Immutable ledger: rows are never updated or deleted, only inserted.
create table wallet_transactions (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchants(id) on delete cascade,
  merchant_order_id uuid references merchant_orders(id),
  type wallet_txn_type not null,
  amount numeric(14,2) not null, -- positive = credit, negative = debit
  balance_after numeric(14,2) not null,
  note text,
  created_at timestamptz not null default now()
);

create index idx_wallet_transactions_merchant on wallet_transactions(merchant_id);

create or replace function prevent_ledger_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'wallet_transactions is an immutable ledger; % not allowed', tg_op;
end;
$$;

create trigger wallet_transactions_no_update
  before update or delete on wallet_transactions
  for each row execute function prevent_ledger_mutation();

-- Appends a ledger entry and updates the merchant's cached balance atomically.
create or replace function post_wallet_transaction(
  p_merchant_id uuid,
  p_merchant_order_id uuid,
  p_type wallet_txn_type,
  p_amount numeric,
  p_note text default null
)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_new_balance numeric;
begin
  insert into merchant_wallets (merchant_id, balance)
  values (p_merchant_id, 0)
  on conflict (merchant_id) do nothing;

  update merchant_wallets
  set balance = balance + p_amount, updated_at = now()
  where merchant_id = p_merchant_id
  returning balance into v_new_balance;

  insert into wallet_transactions (merchant_id, merchant_order_id, type, amount, balance_after, note)
  values (p_merchant_id, p_merchant_order_id, p_type, p_amount, v_new_balance, p_note);
end;
$$;

create type commission_scope_type as enum (
  'platform',
  'category',
  'merchant',
  'campaign'
);

create table commission_rules (
  id uuid primary key default gen_random_uuid(),
  scope_type commission_scope_type not null,
  scope_id uuid, -- null for platform-wide; category_id / merchant_id / campaign_id otherwise
  rate_percent numeric(5,2) not null check (rate_percent >= 0 and rate_percent <= 100),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create type settlement_status as enum (
  'pending',
  'processing',
  'paid'
);

create table settlements (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchants(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  total_amount numeric(14,2) not null default 0,
  status settlement_status not null default 'pending',
  created_at timestamptz not null default now(),
  paid_at timestamptz
);

create table settlement_items (
  id uuid primary key default gen_random_uuid(),
  settlement_id uuid not null references settlements(id) on delete cascade,
  merchant_order_id uuid not null references merchant_orders(id),
  amount numeric(14,2) not null
);

create index idx_settlements_merchant on settlements(merchant_id);
create index idx_settlement_items_settlement on settlement_items(settlement_id);
