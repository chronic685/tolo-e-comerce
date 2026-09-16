create type payment_status as enum (
  'pending',
  'verified',
  'failed',
  'refunded'
);

create table payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  provider text not null,
  amount numeric(12,2) not null,
  currency text not null default 'ETB',
  status payment_status not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger payments_set_updated_at
  before update on payments
  for each row execute function set_updated_at();

-- Raw provider callbacks/verification attempts; append-only audit trail per payment.
create table payment_transactions (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references payments(id) on delete cascade,
  provider_reference text,
  status payment_status not null,
  raw_response jsonb,
  verified_at timestamptz,
  created_at timestamptz not null default now()
);

create index idx_payments_order on payments(order_id);
create index idx_payment_transactions_payment on payment_transactions(payment_id);
