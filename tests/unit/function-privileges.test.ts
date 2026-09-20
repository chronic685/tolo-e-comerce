import { describe, expect, it } from "vitest";
import { serviceClient } from "../env.ts";

// Phase 5b regression: this is the fourth time this session a function
// turned out to be reachable by someone it shouldn't be (payment-webhook,
// delivery-dispatch, escalate_unacknowledged_orders, then
// release_stock/reserve_stock/post_wallet_transaction/create_order/etc. —
// see migration 0035). Postgres grants EXECUTE on every new function to
// PUBLIC by default, which PostgREST auto-exposes as a callable RPC to any
// anon/authenticated caller unless explicitly revoked. This test makes that
// bug class fail CI instead of being found by hand a fifth time: it
// enumerates every function in the public schema (via list_function_privileges(),
// migration 0035) and fails if anything not on the explicit allow-list
// below is callable by anon or authenticated.
//
// Matched by function name only, not full signature — there are no
// overloaded functions in this schema today, so this stays simple rather
// than encoding every argument type here too. If an overload is ever
// introduced, this test needs the same scrutiny applied to it as everything
// else on this list.
const ALLOWED_ANON_OR_AUTHENTICATED_FUNCTIONS = new Set([
  // RLS-policy-internal helpers: referenced directly inside USING/WITH CHECK
  // clauses across most tables. RLS predicates run as the querying role, so
  // anon/authenticated must keep EXECUTE or every RLS-protected query breaks.
  "is_tolo_admin",
  "is_tolo_finance",
  "is_tolo_marketing",
  "is_tolo_merchant_verification",
  "is_tolo_ops_or_admin",
  "is_tolo_staff",
  "is_tolo_support",
  "is_merchant_member",
  "is_merchant_owner_or_store_manager",
  "merchant_id_for_merchant_order",
  "merchant_id_for_product",
  "merchant_id_for_variant",
  "order_owner",
  "order_owner_for_merchant_order",

  // PostgREST "computed column" functions (products_customer_price /
  // product_variants_customer_price appear as customer_price:... in
  // frontend select strings) — PostgREST calls these as the requesting
  // role. get_commission_rate is called from inside both, and neither of
  // them is security definer, so the nested call runs as the original
  // caller too — revoking it breaks customer_price on every listing.
  // Read-only, no side effects; the rate is already implicit in the public
  // customer_price/base_price a customer can see regardless.
  "products_customer_price",
  "product_variants_customer_price",
  "get_commission_rate",

  // Phase 5d, item 9: mirrors resolve_delivery_fee's nearest-active-zone
  // lookup but returns only estimated_delivery_minutes -- no fee, no zone
  // identity -- for the order-confirmation screen. Unlike resolve_delivery_fee
  // (which decides the actual charged fee and must stay server-only), a
  // coarse ETA has no pricing information to protect, so it's deliberately
  // granted to authenticated rather than routed through an Edge Function.
  "get_estimated_delivery_minutes",

  // Trigger functions: PostgREST excludes functions returning "trigger"
  // from its exposed /rpc/ API, and calling one directly would fail anyway
  // (no TG_OP/NEW/OLD outside a real trigger firing) — not a live hole, so
  // deliberately not touched in migration 0035 pending a safer, isolated
  // check of exactly how revoking these interacts with trigger firing.
  "claw_back_wallet_on_refund_completed",
  "restock_on_return_received",
  "trg_check_listing_on_product_status_change",
  "trg_check_listing_on_variant_price_change",
  "trg_check_listing_on_inventory_change",
  "enforce_review_rate_limit",
  "handle_new_user",
  "log_config_change",
  "notify_merchant_status_change",
  "prevent_ledger_mutation",
  "prevent_role_self_escalation",
  "prevent_status_self_change",
  "set_updated_at",
]);

interface FunctionPrivilegeRow {
  proname: string;
  anon_exec: boolean;
  authenticated_exec: boolean;
  is_security_definer: boolean;
}

describe("function privileges: no un-reviewed function is callable by anon/authenticated", () => {
  const db = serviceClient();

  it("every public-schema function either is allow-listed or has no anon/authenticated EXECUTE", async () => {
    const { data, error } = await db.rpc("list_function_privileges");
    expect(error).toBeNull();
    const rows = data as FunctionPrivilegeRow[];
    expect(rows.length).toBeGreaterThan(20); // sanity: the introspection query itself is working

    const unexpected = rows.filter((r) => (r.anon_exec || r.authenticated_exec) && !ALLOWED_ANON_OR_AUTHENTICATED_FUNCTIONS.has(r.proname));

    expect(unexpected, `Unexpected anon/authenticated EXECUTE grant(s): ${JSON.stringify(unexpected)}`).toEqual([]);
  });

  it("every function Phase 5b explicitly locked down is confirmed not callable by anon or authenticated", async () => {
    const lockedDown = [
      "release_stock",
      "reserve_stock",
      "post_wallet_transaction",
      "create_order",
      "resolve_best_discount",
      "resolve_delivery_fee",
      "haversine_km",
      "check_and_record_rate_limit",
      "get_rate_limit_config",
      "escalate_unacknowledged_orders",
      "list_function_privileges",
    ];

    const { data, error } = await db.rpc("list_function_privileges");
    expect(error).toBeNull();
    const rows = data as FunctionPrivilegeRow[];

    for (const name of lockedDown) {
      const row = rows.find((r) => r.proname === name);
      expect(row, `${name} not found in public schema`).toBeTruthy();
      expect(row!.anon_exec, `${name} is still executable by anon`).toBe(false);
      expect(row!.authenticated_exec, `${name} is still executable by authenticated`).toBe(false);
    }
  });

  it("every function on the allow-list actually exists (catches stale entries after a rename/drop)", async () => {
    const { data, error } = await db.rpc("list_function_privileges");
    expect(error).toBeNull();
    const rows = data as FunctionPrivilegeRow[];
    const knownNames = new Set(rows.map((r) => r.proname));

    for (const name of ALLOWED_ANON_OR_AUTHENTICATED_FUNCTIONS) {
      expect(knownNames.has(name), `Allow-listed function "${name}" no longer exists in the public schema`).toBe(true);
    }
  });
});
