-- Group 3, item 10: merchant promotions (percentage or fixed, date range,
-- per product or shop), applied server-side at checkout. The schema and
-- the server-side application already existed in full --
-- discount_rules already supports scope_type 'merchant'/'product',
-- discount_kind 'percent'/'fixed', starts_at/ends_at, and funded_by
-- 'merchant' (migration 0026), and resolve_best_discount()/create_order()
-- already match and apply any is_active rule regardless of who created it
-- (migration 0046) -- but discount_rules_manage RLS only ever allowed
-- has_admin_page(['pricing_rules']), so only Tolo staff could ever create
-- one. This adds the missing piece: letting a merchant manage their own
-- self-funded promotions.
--
-- Deliberately scoped to only what was asked (percent/fixed, date range,
-- product-or-shop scope): a merchant can only create funded_by='merchant'
-- rules with scope_type 'merchant' (their own store) or 'product' (one of
-- their own products) -- never platform/category scope, never
-- tolo/shared-funded, never a promo code, usage cap, or first-order-only
-- flag (those stay admin-only levers, same as before). Team-based, not
-- creator-based: any staff member of the merchant can manage a
-- funded_by='merchant' rule scoped to that merchant, the same access
-- model every other merchant-owned resource in this schema already uses
-- (products, staff, store settings) -- not just whoever happened to
-- create the row. This also means a merchant can never touch a
-- Tolo-created, tolo/shared-funded promo even if it happens to target
-- their shop.
create or replace function discount_scope_owned_by_calling_merchant(p_scope_type discount_scope_type, p_scope_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select case p_scope_type
    when 'merchant' then is_merchant_member(p_scope_id)
    when 'product' then is_merchant_member(merchant_id_for_product(p_scope_id))
    else false
  end;
$$;

-- discount_rules_select already lets everyone read non-customer-specific
-- rules (reward_for_customer_id is null), which covers merchants reading
-- their own -- no change needed there.
alter policy discount_rules_manage on discount_rules
  using (
    has_admin_page(array['pricing_rules'])
    or (funded_by = 'merchant' and discount_scope_owned_by_calling_merchant(scope_type, scope_id))
  )
  with check (
    has_admin_page(array['pricing_rules'])
    or (
      funded_by = 'merchant'
      and scope_type in ('merchant', 'product')
      and discount_scope_owned_by_calling_merchant(scope_type, scope_id)
    )
  );
