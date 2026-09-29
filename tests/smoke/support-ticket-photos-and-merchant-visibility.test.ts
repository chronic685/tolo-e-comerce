import { createClient } from "@supabase/supabase-js";
import { afterEach, beforeAll, describe, expect, inject, it } from "vitest";
import { env, serviceClient, signIn } from "../env.ts";

// Group 4, item 14 (migration 0064). "Report a problem" already existed
// (support_tickets, OrderDetail.tsx's DisputeWidget) but support_tickets_
// select only ever let the reporting customer or Tolo staff see a ticket,
// and there was no photo upload at all. Verifies the new merchant read
// access and the support-ticket-photos storage RLS (a customer can only
// upload under their own order's merchant_order_id; only that order's
// customer, the merchant it belongs to, or staff can read it back).
const db = serviceClient();

function authedClient(token: string) {
  return createClient(env.supabaseUrl, env.anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function createDisposableOrder(customerUserId: string, addressId: string, variantId: string) {
  const { data: orderId, error } = await db.rpc("create_order", {
    p_customer_id: customerUserId,
    p_address_id: addressId,
    p_items: [{ variant_id: variantId, quantity: 1 }],
  });
  if (error) throw error;
  const { data: mo, error: moError } = await db.from("merchant_orders").select("id").eq("order_id", orderId as string).single();
  if (moError) throw moError;
  return mo.id as string;
}

describe("support ticket photos + merchant visibility (migration 0064)", () => {
  let customerToken: string;
  let customerUserId: string;
  let merchantAToken: string;
  let merchantBToken: string;
  let addressId: string;
  let variantId: string;
  const createdTicketIds: string[] = [];

  beforeAll(async () => {
    customerToken = await signIn(env.qaCustomerEmail, env.qaCustomerPassword);
    merchantAToken = await signIn(env.qaMerchantAEmail, env.qaMerchantAPassword);
    merchantBToken = await signIn(env.qaMerchantBEmail, env.qaMerchantBPassword);
    const fixtures = inject("qaFixtures");
    customerUserId = fixtures.customerUserId;
    addressId = fixtures.addressId;
    variantId = fixtures.variantId;
  });

  afterEach(async () => {
    for (const id of createdTicketIds.splice(0)) {
      await db.from("support_tickets").delete().eq("id", id);
    }
  });

  it("a merchant can read a ticket about their own order; another merchant cannot", async () => {
    const merchantOrderId = await createDisposableOrder(customerUserId, addressId, variantId);
    const { data: ticket, error: insertError } = await db
      .from("support_tickets")
      .insert({ user_id: customerUserId, merchant_order_id: merchantOrderId, subject: "QA TEST — merchant visibility", body: "test" })
      .select()
      .single();
    expect(insertError).toBeNull();
    createdTicketIds.push(ticket!.id);

    const merchantAClient = authedClient(merchantAToken);
    const { data: ownRead, error: ownError } = await merchantAClient.from("support_tickets").select("id").eq("id", ticket!.id).maybeSingle();
    expect(ownError).toBeNull();
    expect(ownRead).not.toBeNull();

    const merchantBClient = authedClient(merchantBToken);
    const { data: otherRead } = await merchantBClient.from("support_tickets").select("id").eq("id", ticket!.id).maybeSingle();
    expect(otherRead).toBeNull();
  });

  it("the reporting customer can upload a photo under their own order's path", async () => {
    const merchantOrderId = await createDisposableOrder(customerUserId, addressId, variantId);
    const customerClient = authedClient(customerToken);

    const path = `${merchantOrderId}/qa-test-${Date.now()}.txt`;
    const { error } = await customerClient.storage.from("support-ticket-photos").upload(path, new Blob(["qa test photo content"]));
    expect(error).toBeNull();

    await db.storage.from("support-ticket-photos").remove([path]);
  });

  it("a different customer cannot upload under an order that isn't theirs", async () => {
    const merchantOrderId = await createDisposableOrder(customerUserId, addressId, variantId);

    // Merchant A's own account is a convenient "someone else" identity here
    // -- not the order's customer, so the insert check must reject it.
    const merchantAClient = authedClient(merchantAToken);
    const path = `${merchantOrderId}/qa-test-${Date.now()}.txt`;
    const { error } = await merchantAClient.storage.from("support-ticket-photos").upload(path, new Blob(["not allowed"]));
    expect(error).not.toBeNull();
  });

  it("the involved merchant can read an uploaded photo back; an uninvolved merchant cannot", async () => {
    const merchantOrderId = await createDisposableOrder(customerUserId, addressId, variantId);
    const customerClient = authedClient(customerToken);
    const path = `${merchantOrderId}/qa-test-${Date.now()}.txt`;
    const { error: uploadError } = await customerClient.storage.from("support-ticket-photos").upload(path, new Blob(["photo bytes"]));
    expect(uploadError).toBeNull();

    try {
      const merchantAClient = authedClient(merchantAToken);
      const { data: ownDownload, error: ownError } = await merchantAClient.storage.from("support-ticket-photos").download(path);
      expect(ownError).toBeNull();
      expect(ownDownload).not.toBeNull();

      const merchantBClient = authedClient(merchantBToken);
      const { error: otherError } = await merchantBClient.storage.from("support-ticket-photos").download(path);
      expect(otherError).not.toBeNull();
    } finally {
      await db.storage.from("support-ticket-photos").remove([path]);
    }
  });
});
