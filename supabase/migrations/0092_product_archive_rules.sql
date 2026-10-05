-- Archive and restore, with a record of who archived and a rule about who may undo it.
--
--   * a product archived by its merchant can be restored by that merchant (owner or
--     staff) or by Tolo admin staff;
--   * a product archived by Tolo admin staff can be restored only by admin staff:
--     the merchant sees "Archived by admin" and nothing they do can bring it back.
--
-- Enforced here, in a trigger on products, so it holds whatever client writes the
-- row (the merchant and admin dashboards, a script, a hand-written update). The
-- archived_* columns are set only by the trigger; a client value for them is
-- ignored. Every archive, restore (and, in 0091, delete) by a person is written to
-- audit_logs.

alter table products
  add column archived_at timestamptz,
  add column archived_by uuid references profiles(id) on delete set null,
  add column archived_by_role text check (archived_by_role in ('merchant', 'staff')),
  add column archived_from_status product_status;

-- Products archived before this existed (one on live): merchants had no way to
-- archive, so these were Tolo's doing. Marking them 'staff' is the safe reading:
-- only admin staff can restore them. Who exactly is not recorded.
update products
set archived_at = coalesce(updated_at, now()),
    archived_by_role = 'staff'
where status = 'archived' and archived_by_role is null;

create or replace function trg_enforce_product_archive_rules()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_staff boolean := has_admin_page(array['products']);
  v_member boolean;
  v_system boolean := auth.uid() is null; -- the service role / a migration, trusted
begin
  if tg_op = 'INSERT' then
    v_member := is_merchant_member(new.merchant_id);
    if new.status = 'archived' then
      new.archived_at := now();
      new.archived_by := auth.uid();
      new.archived_by_role := case when v_staff or v_system then 'staff' when v_member then 'merchant' else 'staff' end;
      new.archived_from_status := null;
    else
      new.archived_at := null; new.archived_by := null; new.archived_by_role := null; new.archived_from_status := null;
    end if;
    return new;
  end if;

  v_member := is_merchant_member(old.merchant_id);

  if new.status = 'archived' and old.status <> 'archived' then
    -- Archiving. A caller who is admin staff archives as staff, whoever owns the product.
    if not (v_staff or v_member or v_system) then
      raise exception 'Not authorized for this product';
    end if;
    new.archived_at := now();
    new.archived_by := auth.uid();
    new.archived_by_role := case when v_staff or v_system then 'staff' else 'merchant' end;
    new.archived_from_status := old.status;
    if auth.uid() is not null then
      insert into audit_logs (actor_id, action, entity_type, entity_id, metadata)
      values (auth.uid(), 'archive', 'products', old.id,
              jsonb_build_object('role', new.archived_by_role, 'from_status', old.status, 'name', old.name, 'merchant_id', old.merchant_id));
    end if;

  elsif old.status = 'archived' and new.status <> 'archived' then
    -- Restoring.
    if not (v_staff or v_system) then
      if old.archived_by_role = 'staff' then
        raise exception 'This product was archived by Tolo and only Tolo staff can restore it.';
      end if;
      if not v_member then
        raise exception 'Not authorized for this product';
      end if;
    end if;
    if auth.uid() is not null then
      insert into audit_logs (actor_id, action, entity_type, entity_id, metadata)
      values (auth.uid(), 'restore', 'products', old.id,
              jsonb_build_object('role', case when v_staff then 'staff' else 'merchant' end, 'archived_by_role', old.archived_by_role,
                                 'to_status', new.status, 'name', old.name, 'merchant_id', old.merchant_id));
    end if;
    new.archived_at := null; new.archived_by := null; new.archived_by_role := null; new.archived_from_status := null;

  else
    -- Status not moving into or out of archived: the archive record cannot be edited by hand.
    new.archived_at := old.archived_at;
    new.archived_by := old.archived_by;
    new.archived_by_role := old.archived_by_role;
    new.archived_from_status := old.archived_from_status;
    -- A product Tolo archived is frozen for the merchant: no edits while it is archived.
    if old.status = 'archived' and old.archived_by_role = 'staff' and not (v_staff or v_system) then
      raise exception 'This product was archived by Tolo and only Tolo staff can change it.';
    end if;
  end if;

  return new;
end;
$$;

create trigger products_enforce_archive_rules
  before insert or update on products
  for each row execute function trg_enforce_product_archive_rules();

-- A merchant also cannot delete a product Tolo archived (it would sidestep the rule).
create or replace function trg_guard_product_delete()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if old.status = 'archived' and old.archived_by_role = 'staff'
     and auth.uid() is not null and not has_admin_page(array['products']) then
    raise exception 'This product was archived by Tolo and only Tolo staff can delete it.';
  end if;

  if product_has_orders(old.id) then
    raise exception 'This product has been ordered, so it cannot be deleted. Archive it instead.';
  end if;

  if auth.uid() is not null then
    insert into audit_logs (actor_id, action, entity_type, entity_id, metadata)
    values (auth.uid(), 'delete', 'products', old.id, jsonb_build_object('name', old.name, 'merchant_id', old.merchant_id, 'status', old.status));
  end if;
  return old;
end;
$$;

-- Bulk helpers for the dashboards. Both run as the caller (not security definer), so
-- row-level security decides which products they can touch and the trigger above
-- decides what they may do to them.
create or replace function archive_products(p_ids uuid[])
returns int
language plpgsql set search_path = public
as $$
declare
  v_count int;
begin
  update products set status = 'archived' where id = any(p_ids) and status <> 'archived';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- A restored product comes back hidden (paused), or as a draft if it had never gone
-- live, never straight to published: showing it again is a separate step that runs
-- the usual listing-eligibility check. Products the caller is not allowed to restore
-- are counted as blocked rather than failing the whole batch.
create or replace function restore_products(p_ids uuid[])
returns table (restored int, blocked int)
language plpgsql set search_path = public
as $$
declare
  v_row record;
  v_restored int := 0;
  v_blocked int := 0;
begin
  for v_row in select id, archived_from_status from products where id = any(p_ids) and status = 'archived' loop
    begin
      update products
      set status = case when v_row.archived_from_status in ('draft', 'submitted') then 'draft'::product_status else 'paused'::product_status end
      where id = v_row.id;
      v_restored := v_restored + 1;
    exception when raise_exception then
      v_blocked := v_blocked + 1;
    end;
  end loop;
  return query select v_restored, v_blocked;
end;
$$;

revoke execute on function archive_products(uuid[]) from public, anon;
revoke execute on function restore_products(uuid[]) from public, anon;
grant execute on function archive_products(uuid[]) to authenticated, service_role;
grant execute on function restore_products(uuid[]) to authenticated, service_role;
