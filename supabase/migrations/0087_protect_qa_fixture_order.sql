-- The test suite keeps one permanent "new" order of QA Merchant A that the
-- tenant-isolation and payment-spoofing tests assert against, marked by a note on
-- its status-history row (tests/fixtures/ensureQaFixtures.ts). A bulk cleanup
-- deleted it once (migration 0083's first live run), so qa_order_blocker() now
-- refuses any order carrying that marker and delete_qa_orders() skips or
-- aborts on it like any other ineligible order ('protected_fixture').
create or replace function qa_order_blocker(p_order_id uuid)
returns text
language plpgsql stable security definer set search_path = public
as $$
declare
  v_mo_ids uuid[];
begin
  if not exists (select 1 from orders where id = p_order_id) then
    return 'order_not_found';
  end if;

  select coalesce(array_agg(id), '{}') into v_mo_ids from merchant_orders where order_id = p_order_id;

  if exists (
    select 1 from merchant_orders mo join merchants m on m.id = mo.merchant_id
    where mo.order_id = p_order_id and not m.is_test
  ) then
    return 'not_a_test_order';
  end if;

  if exists (select 1 from order_status_history where merchant_order_id = any(v_mo_ids) and note like 'QA FIXTURE:%') then
    return 'protected_fixture';
  end if;

  if exists (select 1 from wallet_transactions where merchant_order_id = any(v_mo_ids))
     or exists (select 1 from settlement_items where merchant_order_id = any(v_mo_ids))
     or exists (select 1 from financial_adjustments where order_id = p_order_id)
     or exists (select 1 from discount_redemptions where order_id = p_order_id)
     or exists (select 1 from reviews where merchant_order_id = any(v_mo_ids))
     or exists (select 1 from returns where merchant_order_id = any(v_mo_ids))
     or exists (select 1 from support_tickets where merchant_order_id = any(v_mo_ids)) then
    return 'has_references';
  end if;

  if exists (
    select 1 from payments p
    where p.order_id = p_order_id
      and (p.status in ('verified', 'refunded') or exists (select 1 from payment_transactions t where t.payment_id = p.id))
  ) then
    return 'payment_settled';
  end if;

  if exists (
    select 1 from inventory_movements
    where reference_type = 'order' and reference_id = p_order_id and movement_type in ('sale', 'return')
  ) then
    return 'stock_already_sold';
  end if;

  return null;
end;
$$;
