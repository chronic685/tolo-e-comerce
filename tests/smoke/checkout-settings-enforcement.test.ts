import { afterEach, beforeAll, describe, expect, inject, it } from "vitest";
import { env, serviceClient, signIn } from "../env.ts";
import { callFunction } from "../helpers.ts";

// Phase 8: wires up three system_settings keys the earlier sweep found were
// read only by Settings.tsx (payment_methods was already read by
// Checkout.tsx client-side, but never validated server-side). All three
// checks live in create_order() itself, not checkout/index.ts, except the
// payment-provider check, which has nowhere else to live since
// create_order() never sees the payment provider at all.
const db = serviceClient();

async function updateSetting(key: string, mutate: (current: unknown) => unknown): Promise<unknown> {
  const { data } = await db.from("system_settings").select("value").eq("key", key).single();
  const original = data!.value;
  await db.from("system_settings").update({ value: mutate(original) }).eq("key", key);
  return original;
}

async function restoreSetting(key: string, original: unknown) {
  await db.from("system_settings").update({ value: original }).eq("key", key);
}

describe("checkout: server-side enforcement of previously-unwired settings", () => {
  // Deliberately NOT qaCustomerEmail for the tests that call the checkout
  // Edge Function (payment_methods/min_order_value below) — same reasoning
  // as rate-limiting.test.ts: other test files already call checkout with
  // that identity and share its 5-per-10-minutes quota, and this file alone
  // would push it to the limit. Merchant B is otherwise idle here (only
  // rate-limiting.test.ts uses Merchant A for its own dedicated
  // checkout-exhaustion test), and checkout/create_order never check that
  // the caller actually owns address_id, so any authenticated identity
  // works for these specific checks.
  let merchantBToken: string;
  let merchantBUserId: string;
  let customerUserId: string;
  let addressId: string;
  let variantId: string;
  let merchantAId: string;

  beforeAll(async () => {
    merchantBToken = await signIn(env.qaMerchantBEmail, env.qaMerchantBPassword);
    const fixtures = inject("qaFixtures");
    merchantBUserId = fixtures.merchantBUserId;
    customerUserId = fixtures.customerUserId;
    addressId = fixtures.addressId;
    variantId = fixtures.variantId;
    merchantAId = fixtures.merchantAId;
  });

  describe("payment_methods", () => {
    it("rejects checkout when the chosen provider is disabled in settings", async () => {
      const original = await updateSetting("payment_methods", (v) => ({ ...(v as object), mobile_money: false }));
      try {
        const res = await callFunction("checkout", {
          token: merchantBToken,
          body: { address_id: addressId, payment_provider: "mobile_money" },
        });
        expect(res.status).toBe(400);
        expect((res.json as { error: string }).error).toContain("not currently available");
      } finally {
        await restoreSetting("payment_methods", original);
      }
    });

    it("rejects checkout for a provider that was never a real option at all", async () => {
      const res = await callFunction("checkout", {
        token: merchantBToken,
        body: { address_id: addressId, payment_provider: "bitcoin" },
      });
      expect(res.status).toBe(400);
    });
  });

  describe("min_order_value", () => {
    afterEach(async () => {
      const { data: cart } = await db.from("carts").select("id").eq("customer_id", merchantBUserId).maybeSingle();
      if (cart) await db.from("cart_items").delete().eq("cart_id", cart.id);
    });

    it("rejects checkout when the cart subtotal is below the configured minimum", async () => {
      const original = await updateSetting("min_order_value", () => 999999);
      try {
        let { data: cart } = await db.from("carts").select("id").eq("customer_id", merchantBUserId).maybeSingle();
        if (!cart) {
          const inserted = await db.from("carts").insert({ customer_id: merchantBUserId }).select("id").single();
          cart = inserted.data;
        }
        await db.from("cart_items").insert({ cart_id: cart!.id, variant_id: variantId, quantity: 1 });

        const res = await callFunction("checkout", {
          token: merchantBToken,
          body: { address_id: addressId, payment_provider: "cash_on_delivery" },
        });
        expect(res.status).toBe(400);
        expect((res.json as { error: string }).error).toContain("minimum order value");
      } finally {
        await restoreSetting("min_order_value", original);
      }
    });
  });

  describe("delivery.enabled", () => {
    it("charges no delivery fee at all when delivery is turned off platform-wide", async () => {
      const original = await updateSetting("delivery", (v) => ({ ...(v as object), enabled: false }));
      try {
        const { data: orderId, error } = await db.rpc("create_order", {
          p_customer_id: customerUserId,
          p_address_id: addressId,
          p_items: [{ variant_id: variantId, quantity: 1 }],
        });
        expect(error).toBeNull();

        const { data: order } = await db.from("orders").select("delivery_fee").eq("id", orderId as string).single();
        expect(Number(order!.delivery_fee)).toBe(0);

        // Cleanup: release the reservation and leave the order cancelled,
        // same convention as every other disposable-order test in this suite.
        const { data: mo } = await db.from("merchant_orders").select("id").eq("order_id", orderId as string).single();
        await db.rpc("release_stock", { p_variant_id: variantId, p_quantity: 1, p_reference_id: orderId as string, p_as_sale: false });
        await db.from("merchant_orders").update({ status: "cancelled" }).eq("id", mo!.id);
      } finally {
        await restoreSetting("delivery", original);
      }
    });
  });

  describe("delivery.max_delivery_distance_km", () => {
    // Both fixture store/address normally have no coordinates at all (the
    // check skips gracefully when either is missing), so each test here
    // sets both temporarily and restores them to null afterward.
    const STORE_LAT = 9.0;
    const STORE_LON = 38.7;
    const FAR_ADDRESS_LAT = -4.0; // ~1400km away — exceeds any reasonable configured maximum
    const FAR_ADDRESS_LON = 38.7;

    afterEach(async () => {
      await db.from("stores").update({ latitude: null, longitude: null }).eq("merchant_id", merchantAId);
      await db.from("addresses").update({ latitude: null, longitude: null }).eq("id", addressId);
    });

    it("rejects an order when the delivery address is farther than the configured maximum from the store", async () => {
      await db.from("stores").update({ latitude: STORE_LAT, longitude: STORE_LON }).eq("merchant_id", merchantAId);
      await db.from("addresses").update({ latitude: FAR_ADDRESS_LAT, longitude: FAR_ADDRESS_LON }).eq("id", addressId);
      const original = await updateSetting("delivery", (v) => ({ ...(v as object), max_delivery_distance_km: 50 }));

      try {
        const { data: orderId, error } = await db.rpc("create_order", {
          p_customer_id: customerUserId,
          p_address_id: addressId,
          p_items: [{ variant_id: variantId, quantity: 1 }],
        });
        expect(orderId).toBeNull();
        expect(error).not.toBeNull();
        expect(error!.message).toContain("too far");
      } finally {
        await restoreSetting("delivery", original);
      }
    });

    it("still allows the order when the two points are within the configured maximum", async () => {
      await db.from("stores").update({ latitude: STORE_LAT, longitude: STORE_LON }).eq("merchant_id", merchantAId);
      await db.from("addresses").update({ latitude: STORE_LAT, longitude: STORE_LON }).eq("id", addressId);
      const original = await updateSetting("delivery", (v) => ({ ...(v as object), max_delivery_distance_km: 50 }));

      try {
        const { data: orderId, error } = await db.rpc("create_order", {
          p_customer_id: customerUserId,
          p_address_id: addressId,
          p_items: [{ variant_id: variantId, quantity: 1 }],
        });
        expect(error).toBeNull();
        expect(orderId).toBeTruthy();

        const { data: mo } = await db.from("merchant_orders").select("id").eq("order_id", orderId as string).single();
        await db.rpc("release_stock", { p_variant_id: variantId, p_quantity: 1, p_reference_id: orderId as string, p_as_sale: false });
        await db.from("merchant_orders").update({ status: "cancelled" }).eq("id", mo!.id);
      } finally {
        await restoreSetting("delivery", original);
      }
    });
  });
});
