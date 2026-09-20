import { createClient } from "@supabase/supabase-js";
import { afterEach, beforeAll, describe, expect, inject, it } from "vitest";
import { env, serviceClient, signIn } from "../env.ts";
import { callFunction } from "../helpers.ts";

// Phase 9: merchant-facing staff management. merchant_staff itself has no
// invite/pending-account concept (migration 0002 — just an immediate
// merchant_id/user_id/role row), so adding staff means searching for an
// already-registered account by phone, same approach as admin-dashboard's
// Users.tsx searching for an account to promote to Tolo staff. That search
// needs an Edge Function (merchant-staff-lookup) because profiles' own RLS
// doesn't let an ordinary merchant read another user's profile row at all.
//
// The add/remove actions themselves go through a direct table call from
// Staff.tsx, not an Edge Function — merchant_staff's own RLS
// ("merchant_staff_manage", migration 0014) already restricts insert/
// update/delete to the merchant's owner specifically, not any staff
// member. This file proves that boundary is real at the database level,
// not just assumed from reading the policy.
const db = serviceClient();

function asUser(token: string) {
  return createClient(env.supabaseUrl, env.anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

describe("merchant-staff-lookup", () => {
  let merchantAToken: string;
  let merchantBToken: string;
  let customerUserId: string;

  beforeAll(async () => {
    merchantAToken = await signIn(env.qaMerchantAEmail, env.qaMerchantAPassword);
    merchantBToken = await signIn(env.qaMerchantBEmail, env.qaMerchantBPassword);
    customerUserId = inject("qaFixtures").customerUserId;
  });

  it("rejects a caller who doesn't own any merchant", async () => {
    // Merchant B is a real merchant owner, but not of Merchant A — this
    // proves the check is "do you own *a* merchant" plus "is it *this*
    // one" rather than just "are you any merchant owner at all". Since
    // the function only takes a phone (not a merchant_id), it always
    // resolves the caller's own merchant, so this really tests "a caller
    // with no merchant of their own" — use the QA customer for that.
    const customerToken = await signIn(env.qaCustomerEmail, env.qaCustomerPassword);
    const res = await callFunction("merchant-staff-lookup", {
      token: customerToken,
      body: { phone: "+251900000000" },
    });
    expect(res.status).toBe(403);
  });

  it("returns profile: null for a phone number with no matching account", async () => {
    const res = await callFunction("merchant-staff-lookup", {
      token: merchantAToken,
      body: { phone: "+251900099999" },
    });
    expect(res.status).toBe(200);
    expect((res.json as { profile: unknown }).profile).toBeNull();
  });

  it("finds a real account by phone and flags whether they're already staff", async () => {
    const testPhone = "+251900012345";
    const { data: original } = await db.from("profiles").select("phone").eq("id", customerUserId).single();
    await db.from("profiles").update({ phone: testPhone }).eq("id", customerUserId);

    try {
      const res = await callFunction("merchant-staff-lookup", { token: merchantAToken, body: { phone: testPhone } });
      expect(res.status).toBe(200);
      const body = res.json as { profile: { id: string } | null; already_staff: boolean };
      expect(body.profile?.id).toBe(customerUserId);
      expect(body.already_staff).toBe(false);
    } finally {
      await db.from("profiles").update({ phone: original!.phone }).eq("id", customerUserId);
    }
  });

  it("works for any real merchant owner, not just one specific account", async () => {
    // Confirms the 403 case above is really about "caller owns no merchant
    // at all" rather than something specific to Merchant A — Merchant B is
    // a distinct, real merchant owner and gets a normal 200 here.
    const res = await callFunction("merchant-staff-lookup", {
      token: merchantBToken,
      body: { phone: "+251900099999" },
    });
    expect(res.status).toBe(200);
  });
});

describe("merchant_staff RLS: only the owner manages staff, not any staff member", () => {
  let merchantAToken: string;
  let merchantBToken: string;
  let merchantAId: string;
  let merchantBUserId: string;
  let customerUserId: string;

  beforeAll(async () => {
    merchantAToken = await signIn(env.qaMerchantAEmail, env.qaMerchantAPassword);
    merchantBToken = await signIn(env.qaMerchantBEmail, env.qaMerchantBPassword);
    const fixtures = inject("qaFixtures");
    merchantAId = fixtures.merchantAId;
    merchantBUserId = fixtures.merchantBUserId;
    customerUserId = fixtures.customerUserId;
  });

  afterEach(async () => {
    // Whatever the RLS-blocked attempts left behind (they shouldn't leave
    // anything), clean up via service client regardless.
    await db.from("merchant_staff").delete().eq("merchant_id", merchantAId).eq("user_id", merchantBUserId);
  });

  it("a non-owner staff member cannot add another staff member to that merchant", async () => {
    // Merchant B's own user acting as a plain (non-owner) staff member of
    // Merchant A — a role that exists but grants no staff-management rights.
    await db.from("merchant_staff").insert({ merchant_id: merchantAId, user_id: merchantBUserId, role: "order_manager" });

    const asMerchantB = asUser(merchantBToken);
    const { error } = await asMerchantB
      .from("merchant_staff")
      .insert({ merchant_id: merchantAId, user_id: customerUserId, role: "order_manager" });
    expect(error).not.toBeNull();

    // Not even self-removal is allowed from here — merchant_staff_manage
    // only checks merchants.owner_id, not user_id = auth.uid().
    const { data: ownRow } = await db
      .from("merchant_staff")
      .select("id")
      .eq("merchant_id", merchantAId)
      .eq("user_id", merchantBUserId)
      .single();
    const { error: deleteError, count } = await asMerchantB.from("merchant_staff").delete({ count: "exact" }).eq("id", ownRow!.id);
    expect(deleteError).toBeNull(); // RLS silently matches zero rows, not an error
    expect(count).toBe(0);
  });

  it("the owner can add and then remove a staff member directly (the same calls Staff.tsx makes)", async () => {
    const asMerchantA = asUser(merchantAToken);

    const { data: inserted, error: insertError } = await asMerchantA
      .from("merchant_staff")
      .insert({ merchant_id: merchantAId, user_id: merchantBUserId, role: "inventory_manager" })
      .select("id")
      .single();
    expect(insertError).toBeNull();

    const { error: deleteError, count } = await asMerchantA.from("merchant_staff").delete({ count: "exact" }).eq("id", inserted!.id);
    expect(deleteError).toBeNull();
    expect(count).toBe(1);
  });
});
