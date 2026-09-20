-- Phase 5b: this is the fourth time this session a function turned out to
-- be reachable by someone it shouldn't be (payment-webhook, delivery-dispatch,
-- escalate_unacknowledged_orders required the same fix in migration 0033;
-- release_stock/reserve_stock/post_wallet_transaction found this round).
-- Postgres grants EXECUTE on every new function to PUBLIC by default, which
-- PostgREST auto-exposes as a callable RPC to any anon/authenticated caller
-- unless it's explicitly revoked — nothing in this project had ever done
-- that sweep before migration 0033.
--
-- Confirmed via a repo-wide grep of every .rpc(...) call in all three
-- frontends and the test suite: no frontend anywhere calls any of the
-- functions revoked below directly. Every real caller already goes through
-- an Edge Function using the service-role client (which bypasses these
-- grants entirely), or is itself a security-definer function whose nested
-- calls run as the function's owner regardless of the original caller's
-- own grants — so none of this changes how the application actually works.
--
-- NOT revoked here, on purpose (confirmed necessary, not overlooked):
--   - is_tolo_admin/is_tolo_finance/is_tolo_marketing/is_tolo_support/
--     is_tolo_merchant_verification/is_tolo_ops_or_admin/is_tolo_staff,
--     is_merchant_member/is_merchant_owner_or_store_manager,
--     merchant_id_for_merchant_order/merchant_id_for_product/
--     merchant_id_for_variant, order_owner/order_owner_for_merchant_order
--     — referenced directly inside RLS policy USING/WITH CHECK clauses
--     across most tables in this schema. RLS predicates run as the
--     querying role, not some fixed internal role, so anon/authenticated
--     must keep EXECUTE on these or every RLS-protected query breaks.
--   - products_customer_price/product_variants_customer_price — PostgREST
--     "computed column" functions (see products_customer_price:... in
--     Marketplace.tsx's select string); PostgREST calls these as the
--     requesting role when resolving the embedded field.
--   - get_commission_rate — NOT itself a computed column or RLS predicate,
--     but both price functions above call it directly and neither of them
--     is security definer (0021_commission_markup_model.sql), so their
--     nested call runs as the *original caller*, not an owner — revoking
--     this would break customer_price on every product listing. It's
--     read-only with no side effects, and the rate it returns is already
--     implicit in the public customer_price/base_price a customer can
--     already see, so leaving it open costs nothing real.

revoke execute on function release_stock(uuid, integer, uuid, boolean) from public, anon, authenticated;
revoke execute on function reserve_stock(uuid, integer, uuid) from public, anon, authenticated;
revoke execute on function post_wallet_transaction(uuid, uuid, wallet_txn_type, numeric, text) from public, anon, authenticated;

-- create_order() has its own internal "p_customer_id = auth.uid()" check,
-- so a direct caller could only ever create orders for themselves — but
-- doing so skips checkout's rate limiting (Phase 3A) entirely, skips cart
-- validation (a direct call can specify any variant_id/quantity with no
-- cart_items row backing it), and never creates the matching payments row
-- checkout also creates in the same request. All three matter: unlimited
-- direct calls could reserve real stock (reserved_quantity) indefinitely
-- with no way to ever pay for or expire those orders.
revoke execute on function create_order(uuid, uuid, jsonb) from public, anon, authenticated;

revoke execute on function resolve_best_discount(uuid, uuid[], uuid[], uuid[], numeric) from public, anon, authenticated;
revoke execute on function resolve_delivery_fee(numeric, numeric, numeric) from public, anon, authenticated;
-- Low risk on its own (pure distance math, no data access), but no
-- legitimate direct caller exists either — least-privilege, not a reaction
-- to a specific exploit.
revoke execute on function haversine_km(numeric, numeric, numeric, numeric) from public, anon, authenticated;

-- A direct caller fully controls the "key" argument — could exhaust an
-- arbitrary victim's rate-limit window (e.g. check_and_record_rate_limit
-- ('customer:<victim-uuid>:checkout', 0, 999999)) or fill the table with
-- junk keys. get_rate_limit_config only returns two integers and has no
-- side effects, but there's no reason for it to be open either.
revoke execute on function check_and_record_rate_limit(text, integer, integer) from public, anon, authenticated;
revoke execute on function get_rate_limit_config(text) from public, anon, authenticated;

-- Trigger functions (claw_back_wallet_on_refund_completed, enforce_review_rate_limit,
-- handle_new_user, log_config_change, notify_merchant_status_change,
-- prevent_ledger_mutation, prevent_role_self_escalation, prevent_status_self_change,
-- set_updated_at) are deliberately NOT touched here. PostgREST's schema
-- introspection excludes functions that return "trigger" from its exposed
-- /rpc/ API, and calling one directly via a plain SELECT/PERFORM would fail
-- anyway (it requires TG_OP/NEW/OLD, which only exist inside a real trigger
-- firing) — so unlike the functions above, there's no actual path for a
-- direct caller to do anything with these. Revoking EXECUTE from the DML
-- role that fires a trigger risks breaking the trigger itself depending on
-- exactly how Postgres re-checks privilege at fire time, and that's a much
-- larger blast radius (every table's updated_at, role-escalation
-- prevention, etc.) for a hole that doesn't appear to be real. Flagged
-- rather than changed — worth confirming precisely in an isolated test
-- before touching, not assumed safe on the live database.

-- Introspection helper for the regression test
-- (tests/unit/function-privileges.test.ts) that keeps this whole bug class
-- from recurring: enumerates every function in the public schema with
-- whether anon/authenticated can execute it, so the test can fail if
-- anything not on its explicit allow-list is exposed. Called only via the
-- service-role client in tests — locked down the same as everything else
-- in this migration, so it doesn't reintroduce the exact problem it exists
-- to detect.
create or replace function list_function_privileges()
returns table (proname text, anon_exec boolean, authenticated_exec boolean, is_security_definer boolean)
language sql stable security definer set search_path = public
as $$
  select p.proname::text,
         has_function_privilege('anon', p.oid, 'execute'),
         has_function_privilege('authenticated', p.oid, 'execute'),
         p.prosecdef
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prokind = 'f';
$$;

revoke execute on function list_function_privileges() from public, anon, authenticated;
