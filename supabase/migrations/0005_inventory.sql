create table inventory (
  variant_id uuid primary key references product_variants(id) on delete cascade,
  stock_quantity int not null default 0 check (stock_quantity >= 0),
  reserved_quantity int not null default 0 check (reserved_quantity >= 0),
  available_quantity int generated always as (stock_quantity - reserved_quantity) stored,
  low_stock_threshold int not null default 5,
  updated_at timestamptz not null default now(),
  constraint reserved_not_over_stock check (reserved_quantity <= stock_quantity)
);

create trigger inventory_set_updated_at
  before update on inventory
  for each row execute function set_updated_at();

create type inventory_movement_type as enum (
  'restock',
  'sale',
  'return',
  'adjustment',
  'reserve',
  'release'
);

create table inventory_movements (
  id uuid primary key default gen_random_uuid(),
  variant_id uuid not null references product_variants(id) on delete cascade,
  movement_type inventory_movement_type not null,
  quantity int not null,
  reference_type text,
  reference_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid references profiles(id)
);

create index idx_inventory_movements_variant on inventory_movements(variant_id);

-- Atomically reserve stock; raises if insufficient available quantity (prevents overselling).
create or replace function reserve_stock(p_variant_id uuid, p_quantity int, p_reference_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_available int;
begin
  select available_quantity into v_available
  from inventory
  where variant_id = p_variant_id
  for update;

  if v_available is null then
    raise exception 'No inventory record for variant %', p_variant_id;
  end if;

  if v_available < p_quantity then
    raise exception 'Insufficient stock for variant %: requested %, available %', p_variant_id, p_quantity, v_available;
  end if;

  update inventory
  set reserved_quantity = reserved_quantity + p_quantity
  where variant_id = p_variant_id;

  insert into inventory_movements (variant_id, movement_type, quantity, reference_type, reference_id)
  values (p_variant_id, 'reserve', p_quantity, 'order', p_reference_id);
end;
$$;

-- Release a reservation (order cancelled) or convert it to a confirmed sale.
create or replace function release_stock(p_variant_id uuid, p_quantity int, p_reference_id uuid, p_as_sale boolean default false)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if p_as_sale then
    update inventory
    set stock_quantity = stock_quantity - p_quantity,
        reserved_quantity = reserved_quantity - p_quantity
    where variant_id = p_variant_id;

    insert into inventory_movements (variant_id, movement_type, quantity, reference_type, reference_id)
    values (p_variant_id, 'sale', p_quantity, 'order', p_reference_id);
  else
    update inventory
    set reserved_quantity = reserved_quantity - p_quantity
    where variant_id = p_variant_id;

    insert into inventory_movements (variant_id, movement_type, quantity, reference_type, reference_id)
    values (p_variant_id, 'release', p_quantity, 'order', p_reference_id);
  end if;
end;
$$;
