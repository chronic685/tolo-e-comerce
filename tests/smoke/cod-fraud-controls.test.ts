import { afterEach, beforeAll, describe, expect, inject, it } from "vitest";
import { env, serviceClient, signIn } from "../env.ts";
import { callFunction } from "../helpers.ts";

// Group 2, item 9 (migration 0061). Uses a fresh disposable customer per
// test (not qaCustomerEmail) so the COD count starts at exactly zero and
// isn't affected by whatever other test files have already done with the
// shared QA customer in the same run.
const db = serviceClient();
const DISPOSABLE_PASSWORD = "qa-test-password-123";

async function createDisposableCustomer() {
  const email = `qa-codfraud-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
  const { data, error } = await db.auth.admin.createUser({ email, password: DISPOSABLE_PASSWORD, email_confirm: true });
  if (error) throw error;
  return { id: data.user!.id, email };
}

async function addToCart(customerId: string, variantId: string) {
  let { data: cart } = await db.from("carts").select("id").eq("customer_id", customerId).maybeSingle();
  if (!cart) {
    const inserted = await db.from("carts").insert({ customer_id: customerId }).select("id").single();
    cart = inserted.data;
  }
  await db.from("cart_items").insert({ cart_id: cart!.id, variant_id: variantId, quantity: 1 });
}

async function updateCodFraudSetting(value: object) {
  const { data } = await db.from("system_settings").select("value").eq("key", "cod_fraud_controls").single();
  await db.from("system_settings").update({ value }).eq("key", "cod_fraud_controls");
  return data!.value;
}

describe("COD fraud controls (migration 0061)", () => {
  let addressId: string;
  let variantId: string;
  const createdUserIds: string[] = [];
  let originalSetting: unknown;

  beforeAll(async () => {
    const fixtures = inject("qaFixtures");
    addressId = fixtures.addressId;
    variantId = fixtures.variantId;
  });

  afterEach(async () => {
    if (originalSetting !== undefined) {
      await db.from("system_settings").update({ value: originalSetting }).eq("key", "cod_fraud_controls");
      originalSetting = undefined;
    }
    for (const id of createdUserIds.splice(0)) {
      await db.auth.admin.deleteUser(id);
    }
  });

  it("blocks a new account's COD checkout once it reaches max_cod_orders", async () => {
    originalSetting = await updateCodFraudSetting({ enabled: true, new_account_age_days: 7, max_cod_orders: 2, max_cod_amount_etb: 999999 });

    const customer = await createDisposableCustomer();
    createdUserIds.push(customer.id);
    const token = await signIn(customer.email, DISPOSABLE_PASSWORD);

    // First two COD checkouts succeed (within the limit).
    for (let i = 0; i < 2; i++) {
      await addToCart(customer.id, variantId);
      const res = await callFunction("checkout", { token, body: { address_id: addressId, payment_provider: "cash_on_delivery" } });
      expect(res.status).toBe(200);
    }

    // The third hits the limit.
    await addToCart(customer.id, variantId);
    const blocked = await callFunction("checkout", { token, body: { address_id: addressId, payment_provider: "cash_on_delivery" } });
    expect(blocked.status).toBe(403);
    expect((blocked.json as { error: string }).error).toContain("cash-on-delivery");
  });

  it("does not apply to an account older than new_account_age_days", async () => {
    originalSetting = await updateCodFraudSetting({ enabled: true, new_account_age_days: 7, max_cod_orders: 1, max_cod_amount_etb: 999999 });

    const customer = await createDisposableCustomer();
    createdUserIds.push(customer.id);
    // Backdate the profile so it no longer counts as "new".
    await db
      .from("profiles")
      .update({ created_at: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString() })
      .eq("id", customer.id);
    const token = await signIn(customer.email, DISPOSABLE_PASSWORD);

    // Two COD checkouts, past the max_cod_orders: 1 limit -- both succeed
    // because the account isn't "new" by the configured age.
    for (let i = 0; i < 2; i++) {
      await addToCart(customer.id, variantId);
      const res = await callFunction("checkout", { token, body: { address_id: addressId, payment_provider: "cash_on_delivery" } });
      expect(res.status).toBe(200);
    }
  });

  it("does not block anything when disabled, even a brand-new account well past the limit", async () => {
    originalSetting = await updateCodFraudSetting({ enabled: false, new_account_age_days: 7, max_cod_orders: 1, max_cod_amount_etb: 1 });

    const customer = await createDisposableCustomer();
    createdUserIds.push(customer.id);
    const token = await signIn(customer.email, DISPOSABLE_PASSWORD);

    for (let i = 0; i < 2; i++) {
      await addToCart(customer.id, variantId);
      const res = await callFunction("checkout", { token, body: { address_id: addressId, payment_provider: "cash_on_delivery" } });
      expect(res.status).toBe(200);
    }
  });

  it("never blocks a non-COD payment provider for a new account", async () => {
    originalSetting = await updateCodFraudSetting({ enabled: true, new_account_age_days: 7, max_cod_orders: 0, max_cod_amount_etb: 0 });

    const customer = await createDisposableCustomer();
    createdUserIds.push(customer.id);
    const token = await signIn(customer.email, DISPOSABLE_PASSWORD);

    await addToCart(customer.id, variantId);
    const res = await callFunction("checkout", { token, body: { address_id: addressId, payment_provider: "bank_transfer" } });
    expect(res.status).toBe(200);
  });
});
