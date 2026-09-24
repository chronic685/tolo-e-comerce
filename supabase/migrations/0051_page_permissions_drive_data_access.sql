-- Makes the page checklist (profiles.permissions, migration 0049) the actual
-- rule for what a staff member can reach in the database, not just what the
-- admin dashboard shows. Until now RLS granted staff access by `role`
-- (is_tolo_staff/finance/marketing/support/merchant_verification/
-- ops_or_admin), so a staff member's checklist and their real data access
-- could disagree -- e.g. role tolo_admin with no finance pages still had
-- full finance access, and the super admin (role tolo_finance) couldn't
-- approve merchants.
--
-- After this migration:
--   - role  : only marks a profile as a platform staff account (any tolo_*
--             value); which one is a label and grants nothing.
--   - tier  : admin/super_admin reach everything (unchanged).
--   - pages : everything else is granted per page. Reads are allowed for
--             every page that displays a table (including via joins, e.g.
--             Orders shows merchant names); writes only for the page that
--             manages it.
-- Unchanged on purpose: account management (profiles UPDATE, tiers,
-- permissions) and system_settings writes stay admin-tier only
-- (is_tolo_admin(), migration 0050).

-- 1. The single check everything below uses ---------------------------------
create or replace function has_admin_page(p_keys text[])
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from profiles
    where id = auth.uid()
      and account_status = 'active'
      and (
        admin_tier is not null
        or (role::text like 'tolo\_%' and permissions ?| p_keys)
      )
  );
$$;
-- Referenced inside RLS predicates, which run as the querying role (anon
-- included, e.g. products_public_select_published) -- same reason
-- is_tolo_staff() keeps EXECUTE (migration 0035).
grant execute on function has_admin_page(text[]) to anon, authenticated;

-- 2. Legacy helpers ---------------------------------------------------------
-- No policy references these after section 3; they're redefined rather than
-- dropped so anything still calling them follows the checklist too.
-- is_tolo_staff() keeps its broad meaning ("is an active staff account"):
-- its one remaining caller is create_order()'s maintenance-mode bypass.
create or replace function is_tolo_staff()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and account_status = 'active'
      and (admin_tier is not null or role::text like 'tolo\_%')
  );
$$;

create or replace function is_tolo_finance()
returns boolean
language sql stable security definer set search_path = public
as $$ select has_admin_page(array['payments', 'refunds', 'settlements']); $$;

create or replace function is_tolo_marketing()
returns boolean
language sql stable security definer set search_path = public
as $$ select has_admin_page(array['pricing_rules', 'notification_templates']); $$;

create or replace function is_tolo_support()
returns boolean
language sql stable security definer set search_path = public
as $$ select has_admin_page(array['support']); $$;

create or replace function is_tolo_merchant_verification()
returns boolean
language sql stable security definer set search_path = public
as $$ select has_admin_page(array['merchants']); $$;

create or replace function is_tolo_ops_or_admin()
returns boolean
language sql stable security definer set search_path = public
as $$ select has_admin_page(array['delivery_ops']); $$;

-- 3. Policies ---------------------------------------------------------------
-- Generated from the live policy text: only the staff helper call in each
-- one is swapped for has_admin_page(<pages>); every owner/merchant/customer
-- condition is left exactly as it was. ALTER POLICY keeps each policy's
-- name, command and roles.
alter policy addresses_own on addresses
  using (((customer_id = auth.uid()) OR has_admin_page(array['orders', 'customers', 'delivery_ops'])))
  with check ((customer_id = auth.uid()));

alter policy audit_logs_select_staff on audit_logs
  using (has_admin_page(array['audit_log']));

alter policy categories_manage on categories
  using (has_admin_page(array['products']))
  with check (has_admin_page(array['products']));

alter policy categories_public_select on categories
  using ((is_active OR has_admin_page(array['products', 'pricing_rules'])));

alter policy commission_rules_manage on commission_rules
  using (has_admin_page(array['pricing_rules']))
  with check (has_admin_page(array['pricing_rules']));

alter policy customer_favorites_select on customer_favorites
  using (((customer_id = auth.uid()) OR has_admin_page(array['customers'])));

alter policy deliveries_manage_tolo on deliveries
  using (has_admin_page(array['delivery_ops']))
  with check (has_admin_page(array['delivery_ops']));

alter policy deliveries_select on deliveries
  using ((is_merchant_member(merchant_id_for_merchant_order(merchant_order_id)) OR (order_owner_for_merchant_order(merchant_order_id) = auth.uid()) OR has_admin_page(array['delivery_ops'])));

alter policy delivery_tracking_manage_tolo on delivery_tracking
  using (has_admin_page(array['delivery_ops']))
  with check (has_admin_page(array['delivery_ops']));

alter policy delivery_tracking_select on delivery_tracking
  using ((EXISTS ( SELECT 1
   FROM deliveries d
  WHERE ((d.id = delivery_tracking.delivery_id) AND (is_merchant_member(merchant_id_for_merchant_order(d.merchant_order_id)) OR (order_owner_for_merchant_order(d.merchant_order_id) = auth.uid()) OR has_admin_page(array['delivery_ops']))))));

alter policy delivery_zones_manage on delivery_zones
  using (has_admin_page(array['delivery_ops']))
  with check (has_admin_page(array['delivery_ops']));

alter policy discount_redemptions_select on discount_redemptions
  using (((customer_id = auth.uid()) OR has_admin_page(array['pricing_rules', 'orders'])));

alter policy discount_rules_manage on discount_rules
  using ((has_admin_page(array['pricing_rules'])))
  with check ((has_admin_page(array['pricing_rules'])));

alter policy discount_rules_select on discount_rules
  using (((reward_for_customer_id IS NULL) OR (reward_for_customer_id = auth.uid()) OR has_admin_page(array['pricing_rules'])));

alter policy discount_targets_manage on discount_targets
  using ((has_admin_page(array['pricing_rules'])))
  with check ((has_admin_page(array['pricing_rules'])));

alter policy drivers_manage_tolo on drivers
  using (has_admin_page(array['delivery_ops']))
  with check (has_admin_page(array['delivery_ops']));

alter policy drivers_select_tolo on drivers
  using (has_admin_page(array['delivery_ops']));

alter policy financial_adjustments_manage on financial_adjustments
  using (has_admin_page(array['settlements']))
  with check (has_admin_page(array['settlements']));

alter policy financial_adjustments_select on financial_adjustments
  using ((is_merchant_owner_or_store_manager(merchant_id) OR has_admin_page(array['settlements'])));

alter policy inventory_manage on inventory
  using ((is_merchant_member(merchant_id_for_variant(variant_id)) OR has_admin_page(array['products'])))
  with check ((is_merchant_member(merchant_id_for_variant(variant_id)) OR has_admin_page(array['products'])));

alter policy inventory_select on inventory
  using ((is_merchant_member(merchant_id_for_variant(variant_id)) OR has_admin_page(array['products', 'inventory_movements', 'dashboard'])));

alter policy inventory_movements_insert on inventory_movements
  with check ((is_merchant_member(merchant_id_for_variant(variant_id)) OR has_admin_page(array['products', 'inventory_movements'])));

alter policy inventory_movements_select on inventory_movements
  using ((is_merchant_member(merchant_id_for_variant(variant_id)) OR has_admin_page(array['products', 'inventory_movements'])));

alter policy merchant_documents_insert on merchant_documents
  with check ((is_merchant_member(merchant_id) OR has_admin_page(array['merchants'])));

alter policy merchant_documents_review on merchant_documents
  using (has_admin_page(array['merchants']))
  with check (has_admin_page(array['merchants']));

alter policy merchant_documents_select on merchant_documents
  using ((is_merchant_owner_or_store_manager(merchant_id) OR has_admin_page(array['merchants'])));

alter policy merchant_orders_insert on merchant_orders
  with check (((order_owner(order_id) = auth.uid()) OR has_admin_page(array['orders'])));

alter policy merchant_orders_select on merchant_orders
  using ((is_merchant_member(merchant_id) OR (order_owner(order_id) = auth.uid()) OR has_admin_page(array['orders', 'dashboard', 'support', 'delivery_ops', 'refunds'])));

alter policy merchant_orders_update on merchant_orders
  using ((is_merchant_member(merchant_id) OR has_admin_page(array['orders'])));

alter policy merchant_staff_manage on merchant_staff
  using (((EXISTS ( SELECT 1
   FROM merchants
  WHERE ((merchants.id = merchant_staff.merchant_id) AND (merchants.owner_id = auth.uid())))) OR has_admin_page(array['merchants'])))
  with check (((EXISTS ( SELECT 1
   FROM merchants
  WHERE ((merchants.id = merchant_staff.merchant_id) AND (merchants.owner_id = auth.uid())))) OR has_admin_page(array['merchants'])));

alter policy merchant_staff_select on merchant_staff
  using (((user_id = auth.uid()) OR is_merchant_member(merchant_id) OR has_admin_page(array['merchants'])));

alter policy merchant_wallets_select on merchant_wallets
  using ((is_merchant_owner_or_store_manager(merchant_id) OR has_admin_page(array['settlements'])));

alter policy merchants_insert_application on merchants
  with check (((owner_id = auth.uid()) OR has_admin_page(array['merchants'])));

alter policy merchants_select on merchants
  using (((owner_id = auth.uid()) OR is_merchant_member(id) OR has_admin_page(array['merchants', 'orders', 'dashboard', 'products', 'settlements', 'support', 'delivery_ops', 'refunds', 'pricing_rules'])));

alter policy merchants_update on merchants
  using (((owner_id = auth.uid()) OR has_admin_page(array['merchants'])));

alter policy notification_templates_manage on notification_templates
  using ((has_admin_page(array['notification_templates'])))
  with check ((has_admin_page(array['notification_templates'])));

alter policy notifications_select_own on notifications
  using (((user_id = auth.uid()) OR has_admin_page(array['support'])));

alter policy merchant_documents_storage_delete on storage.objects
  using (((bucket_id = 'merchant-documents'::text) AND (is_merchant_member(((storage.foldername(name))[1])::uuid) OR has_admin_page(array['merchants']))));

alter policy merchant_documents_storage_select on storage.objects
  using (((bucket_id = 'merchant-documents'::text) AND (is_merchant_owner_or_store_manager(((storage.foldername(name))[1])::uuid) OR has_admin_page(array['merchants']))));

alter policy product_images_storage_delete on storage.objects
  using (((bucket_id = 'product-images'::text) AND (is_merchant_member(((storage.foldername(name))[1])::uuid) OR has_admin_page(array['products']))));

alter policy order_items_insert on order_items
  with check (((order_owner_for_merchant_order(merchant_order_id) = auth.uid()) OR has_admin_page(array['orders'])));

alter policy order_items_select on order_items
  using ((is_merchant_member(merchant_id_for_merchant_order(merchant_order_id)) OR (order_owner_for_merchant_order(merchant_order_id) = auth.uid()) OR has_admin_page(array['orders'])));

alter policy order_status_history_insert on order_status_history
  with check ((is_merchant_member(merchant_id_for_merchant_order(merchant_order_id)) OR has_admin_page(array['orders'])));

alter policy order_status_history_select on order_status_history
  using ((is_merchant_member(merchant_id_for_merchant_order(merchant_order_id)) OR (order_owner_for_merchant_order(merchant_order_id) = auth.uid()) OR has_admin_page(array['orders'])));

alter policy orders_select on orders
  using (((customer_id = auth.uid()) OR has_admin_page(array['orders', 'dashboard', 'customers', 'payments'])));

alter policy orders_update_tolo on orders
  using (has_admin_page(array['orders']));

alter policy payment_transactions_manage_finance on payment_transactions
  using (has_admin_page(array['payments']))
  with check (has_admin_page(array['payments']));

alter policy payment_transactions_select on payment_transactions
  using (((EXISTS ( SELECT 1
   FROM payments
  WHERE ((payments.id = payment_transactions.payment_id) AND (order_owner(payments.order_id) = auth.uid())))) OR has_admin_page(array['payments'])));

alter policy payments_insert_own on payments
  with check (((order_owner(order_id) = auth.uid()) OR has_admin_page(array['payments'])));

alter policy payments_select on payments
  using (((order_owner(order_id) = auth.uid()) OR has_admin_page(array['payments'])));

alter policy payments_update_finance on payments
  using (has_admin_page(array['payments']));

alter policy product_images_manage on product_images
  using ((is_merchant_member(merchant_id_for_product(product_id)) OR has_admin_page(array['products'])))
  with check ((is_merchant_member(merchant_id_for_product(product_id)) OR has_admin_page(array['products'])));

alter policy product_images_select on product_images
  using (((EXISTS ( SELECT 1
   FROM products
  WHERE ((products.id = product_images.product_id) AND (products.status = 'published'::product_status)))) OR is_merchant_member(merchant_id_for_product(product_id)) OR has_admin_page(array['products'])));

alter policy product_variants_manage on product_variants
  using ((is_merchant_member(merchant_id_for_product(product_id)) OR has_admin_page(array['products'])))
  with check ((is_merchant_member(merchant_id_for_product(product_id)) OR has_admin_page(array['products'])));

alter policy product_variants_select on product_variants
  using (((EXISTS ( SELECT 1
   FROM products
  WHERE ((products.id = product_variants.product_id) AND (products.status = 'published'::product_status)))) OR is_merchant_member(merchant_id_for_variant(id)) OR has_admin_page(array['products', 'inventory_movements'])));

alter policy products_manage on products
  using ((is_merchant_member(merchant_id) OR has_admin_page(array['products'])))
  with check ((is_merchant_member(merchant_id) OR has_admin_page(array['products'])));

alter policy products_public_select_published on products
  using (((status = 'published'::product_status) OR is_merchant_member(merchant_id) OR has_admin_page(array['products', 'dashboard', 'inventory_movements'])));

alter policy profiles_select_own_or_staff on profiles
  using (((id = auth.uid()) OR has_admin_page(array['customers', 'users', 'payments', 'refunds', 'audit_log', 'dashboard'])));

alter policy refunds_manage_finance on refunds
  using (has_admin_page(array['refunds']))
  with check (has_admin_page(array['refunds']));

alter policy refunds_select on refunds
  using (((EXISTS ( SELECT 1
   FROM returns r
  WHERE ((r.id = refunds.return_id) AND ((r.customer_id = auth.uid()) OR is_merchant_member(merchant_id_for_merchant_order(r.merchant_order_id)))))) OR has_admin_page(array['refunds', 'dashboard'])));

alter policy returns_select on returns
  using (((customer_id = auth.uid()) OR is_merchant_member(merchant_id_for_merchant_order(merchant_order_id)) OR has_admin_page(array['refunds'])));

alter policy returns_update on returns
  using ((is_merchant_member(merchant_id_for_merchant_order(merchant_order_id)) OR has_admin_page(array['refunds'])));

alter policy reviews_delete_own on reviews
  using (((customer_id = auth.uid()) OR has_admin_page(array['products'])));

alter policy reviews_manage_own on reviews
  using (((customer_id = auth.uid()) OR has_admin_page(array['products'])));

alter policy settlement_items_manage_finance on settlement_items
  using (has_admin_page(array['settlements']))
  with check (has_admin_page(array['settlements']));

alter policy settlement_items_select on settlement_items
  using ((EXISTS ( SELECT 1
   FROM settlements
  WHERE ((settlements.id = settlement_items.settlement_id) AND (is_merchant_owner_or_store_manager(settlements.merchant_id) OR has_admin_page(array['settlements']))))));

alter policy settlements_manage_finance on settlements
  using (has_admin_page(array['settlements']))
  with check (has_admin_page(array['settlements']));

alter policy settlements_select on settlements
  using ((is_merchant_owner_or_store_manager(merchant_id) OR has_admin_page(array['settlements'])));

alter policy store_settings_manage on store_settings
  using (((EXISTS ( SELECT 1
   FROM stores
  WHERE ((stores.id = store_settings.store_id) AND is_merchant_member(stores.merchant_id)))) OR has_admin_page(array['merchants'])))
  with check (((EXISTS ( SELECT 1
   FROM stores
  WHERE ((stores.id = store_settings.store_id) AND is_merchant_member(stores.merchant_id)))) OR has_admin_page(array['merchants'])));

alter policy store_settings_select on store_settings
  using ((EXISTS ( SELECT 1
   FROM stores
  WHERE ((stores.id = store_settings.store_id) AND (is_merchant_member(stores.merchant_id) OR has_admin_page(array['merchants']))))));

alter policy stores_manage on stores
  using ((is_merchant_member(merchant_id) OR has_admin_page(array['merchants'])))
  with check ((is_merchant_member(merchant_id) OR has_admin_page(array['merchants'])));

alter policy stores_public_select_active on stores
  using (((status = 'active'::store_status) OR is_merchant_member(merchant_id) OR has_admin_page(array['merchants'])));

alter policy support_tickets_select on support_tickets
  using (((user_id = auth.uid()) OR has_admin_page(array['support', 'dashboard'])));

alter policy support_tickets_update on support_tickets
  using (((user_id = auth.uid()) OR has_admin_page(array['support'])));

alter policy wallet_transactions_select on wallet_transactions
  using ((is_merchant_owner_or_store_manager(merchant_id) OR has_admin_page(array['settlements'])));

-- 4. Escalation alerts go to admins + staff who have the Orders page --------
-- Same function as migration 0048; only the recipient query changes.
create or replace function escalate_unacknowledged_orders()
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  v_threshold_minutes numeric;
  v_in_app_enabled boolean;
  v_claimed record;
  v_ops_user record;
  v_merchant_name text;
  v_waiting_minutes integer;
  v_count integer := 0;
begin
  select (value ->> 'escalate_after_minutes')::numeric into v_threshold_minutes
  from system_settings where key = 'merchant_new_order_alerts';

  if v_threshold_minutes is null or v_threshold_minutes <= 0 then
    return 0;
  end if;

  select coalesce((value ->> 'in_app')::boolean, true) into v_in_app_enabled
  from system_settings where key = 'notification_channels';

  for v_claimed in
    update merchant_orders
    set escalated_at = now()
    where status = 'new'
      and order_received_at is null
      and escalated_at is null
      and notification_sent_at is not null
      and notification_sent_at <= now() - (v_threshold_minutes || ' minutes')::interval
      and (scheduled_for is null or scheduled_for <= now() + (v_threshold_minutes || ' minutes')::interval)
    returning id, merchant_id, notification_sent_at
  loop
    v_count := v_count + 1;

    if v_in_app_enabled then
      begin
        select business_name into v_merchant_name from merchants where id = v_claimed.merchant_id;
        v_waiting_minutes := greatest(0, floor(extract(epoch from (now() - v_claimed.notification_sent_at)) / 60))::integer;

        for v_ops_user in
          select id from profiles
          where account_status = 'active'
            and (admin_tier is not null or (role::text like 'tolo\_%' and permissions ? 'orders'))
        loop
          insert into notifications (user_id, type, title, body)
          select
            v_ops_user.id,
            t.event_type,
            replace(t.title_template, '{{merchant_name}}', coalesce(v_merchant_name, 'a merchant')),
            replace(replace(replace(t.body_template,
              '{{order_id_short}}', left(v_claimed.id::text, 8)),
              '{{merchant_name}}', coalesce(v_merchant_name, 'a merchant')),
              '{{waiting_minutes}}', v_waiting_minutes::text)
          from notification_templates t
          where t.event_type = 'order_unacknowledged_escalated' and t.channel = 'in_app' and t.language = 'en' and t.enabled;
        end loop;
      exception when others then
        raise warning 'escalate_unacknowledged_orders: notification failed for merchant_order %: %', v_claimed.id, sqlerrm;
      end;
    end if;
  end loop;

  return v_count;
end;
$$;

revoke execute on function escalate_unacknowledged_orders() from public, anon, authenticated;
