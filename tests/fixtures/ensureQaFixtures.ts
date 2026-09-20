// One-time, idempotent QA fixture provisioning — NOT part of the regular
// migrations (this is test data, not schema) and NOT re-created on every
// test run. Every row here is clearly labeled "QA TEST" so it's obvious to
// anyone looking at the live project (there is no separate test database —
// see tests/README.md for why) that it's fixture data, never a real
// customer/merchant. The suite only ever performs read-only or
// rejected/negative-path actions against these fixtures, so a single seed
// is reused indefinitely without drifting or needing cleanup between runs.
import { serviceClient } from "../env.ts";

const QA_MERCHANT_A_EMAIL = process.env.QA_MERCHANT_A_EMAIL!;
const QA_MERCHANT_A_PASSWORD = process.env.QA_MERCHANT_A_PASSWORD!;
const QA_MERCHANT_B_EMAIL = process.env.QA_MERCHANT_B_EMAIL!;
const QA_MERCHANT_B_PASSWORD = process.env.QA_MERCHANT_B_PASSWORD!;
const QA_CUSTOMER_EMAIL = process.env.QA_CUSTOMER_EMAIL!;
const QA_CUSTOMER_PASSWORD = process.env.QA_CUSTOMER_PASSWORD!;
const QA_STAFF_EMAIL = process.env.QA_STAFF_EMAIL!;
const QA_STAFF_PASSWORD = process.env.QA_STAFF_PASSWORD!;

export interface QaFixtures {
  merchantAUserId: string;
  merchantAId: string;
  merchantBUserId: string;
  merchantBId: string;
  customerUserId: string;
  /** Tolo staff (role=tolo_admin) — used only for tests exercising the
   * admin/finance-gated functions (settlement-run, delivery-dispatch). */
  staffUserId: string;
  addressId: string;
  variantId: string;
  /** A merchant_order belonging to Merchant A, permanently left in "new"
   * status — never legitimately advanced — so tenant-isolation tests can
   * repeatedly assert "Merchant B may not touch this" without the fixture
   * changing state between runs. */
  merchantOrderId: string;
  paymentId: string;
  /** A SEPARATE merchant_order, already "completed", covering two distinct
   * products — genuinely review-eligible (unlike merchantOrderId above),
   * used only by the review rate-limit test so it can exercise a real
   * successful-then-throttled review sequence instead of only ever hitting
   * the completion-check RLS rejection. */
  reviewableMerchantOrderId: string;
  reviewableProductAId: string;
  reviewableProductBId: string;
}

async function findOrCreateUser(db: ReturnType<typeof serviceClient>, email: string, password: string): Promise<string> {
  const { data: created, error: createError } = await db.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (!createError && created.user) return created.user.id;

  // Already exists — look it up instead of failing the whole seed.
  let page = 1;
  for (;;) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const match = data.users.find((u) => u.email === email);
    if (match) return match.id;
    if (data.users.length < 200) break;
    page += 1;
  }
  throw new Error(`Could not create or find QA user ${email}: ${createError?.message}`);
}

export async function ensureQaFixtures(): Promise<QaFixtures> {
  const db = serviceClient();

  const merchantAUserId = await findOrCreateUser(db, QA_MERCHANT_A_EMAIL, QA_MERCHANT_A_PASSWORD);
  const merchantBUserId = await findOrCreateUser(db, QA_MERCHANT_B_EMAIL, QA_MERCHANT_B_PASSWORD);
  const customerUserId = await findOrCreateUser(db, QA_CUSTOMER_EMAIL, QA_CUSTOMER_PASSWORD);
  const staffUserId = await findOrCreateUser(db, QA_STAFF_EMAIL, QA_STAFF_PASSWORD);

  // profiles rows are created by a trigger on auth.users insert, defaulting
  // to role='customer' — promote this one QA account to Tolo staff directly
  // (a one-time, idempotent fixture step, not something any API exposes).
  await db.from("profiles").update({ role: "tolo_admin", account_status: "active" }).eq("id", staffUserId);

  let { data: merchantA } = await db.from("merchants").select("id").eq("owner_id", merchantAUserId).maybeSingle();
  if (!merchantA) {
    const insertResult = await db
      .from("merchants")
      .insert({
        owner_id: merchantAUserId,
        business_name: "QA TEST — Merchant A — DO NOT USE",
        business_category: "Electronics",
        phone: "+251900000001",
        email: QA_MERCHANT_A_EMAIL,
        location: "QA Fixture",
        status: "active",
        agreement_accepted: true,
        approved_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (insertResult.error) throw insertResult.error;
    merchantA = insertResult.data;
    await db.from("merchant_staff").insert({ merchant_id: merchantA.id, user_id: merchantAUserId, role: "owner" });
  }

  let { data: merchantB } = await db.from("merchants").select("id").eq("owner_id", merchantBUserId).maybeSingle();
  if (!merchantB) {
    const insertResult = await db
      .from("merchants")
      .insert({
        owner_id: merchantBUserId,
        business_name: "QA TEST — Merchant B — DO NOT USE",
        business_category: "Electronics",
        phone: "+251900000002",
        email: QA_MERCHANT_B_EMAIL,
        location: "QA Fixture",
        status: "active",
        agreement_accepted: true,
        approved_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (insertResult.error) throw insertResult.error;
    merchantB = insertResult.data;
    await db.from("merchant_staff").insert({ merchant_id: merchantB.id, user_id: merchantBUserId, role: "owner" });
  }

  let { data: store } = await db.from("stores").select("id").eq("merchant_id", merchantA.id).maybeSingle();
  if (!store) {
    const insertResult = await db
      .from("stores")
      .insert({
        merchant_id: merchantA.id,
        name: "QA TEST Store — DO NOT USE",
        slug: `qa-test-store-${merchantA.id.slice(0, 8)}`,
        status: "active",
      })
      .select("id")
      .single();
    if (insertResult.error) throw insertResult.error;
    store = insertResult.data;
  }

  let { data: product } = await db.from("products").select("id").eq("merchant_id", merchantA.id).eq("sku", "QA-TEST-001").maybeSingle();
  let variantId: string;
  if (!product) {
    const productInsert = await db
      .from("products")
      .insert({
        merchant_id: merchantA.id,
        store_id: store.id,
        name: "QA TEST Product — DO NOT USE",
        slug: `qa-test-product-${merchantA.id.slice(0, 8)}`,
        base_price: 100,
        sku: "QA-TEST-001",
        status: "published",
      })
      .select("id")
      .single();
    if (productInsert.error) throw productInsert.error;
    product = productInsert.data;

    const variantInsert = await db
      .from("product_variants")
      .insert({ product_id: product.id, sku: "QA-TEST-001-DEF", attributes: {}, price: 100, is_default: true })
      .select("id")
      .single();
    if (variantInsert.error) throw variantInsert.error;
    variantId = variantInsert.data.id;

    await db.from("inventory").insert({ variant_id: variantId, stock_quantity: 999999, low_stock_threshold: 1 });
  } else {
    const { data: variant, error } = await db.from("product_variants").select("id").eq("product_id", product.id).single();
    if (error) throw error;
    variantId = variant.id;
  }

  let { data: address } = await db.from("addresses").select("id").eq("customer_id", customerUserId).maybeSingle();
  if (!address) {
    const insertResult = await db
      .from("addresses")
      .insert({
        customer_id: customerUserId,
        label: "QA Fixture",
        recipient_name: "QA TEST Customer",
        phone: "+251900000003",
        line1: "QA Fixture Address",
        city: "Addis Ababa",
        country: "ET",
        is_default: true,
      })
      .select("id")
      .single();
    if (insertResult.error) throw insertResult.error;
    address = insertResult.data;
  }

  let { data: merchantOrder } = await db
    .from("merchant_orders")
    .select("id, order_id")
    .eq("merchant_id", merchantA.id)
    .eq("status", "new")
    .limit(1)
    .maybeSingle();

  let merchantOrderId: string;
  let orderId: string;
  if (!merchantOrder) {
    const { data: newOrderId, error } = await db.rpc("create_order", {
      p_customer_id: customerUserId,
      p_address_id: address.id,
      p_items: [{ variant_id: variantId, quantity: 1 }],
    });
    if (error) throw error;
    orderId = newOrderId as string;
    const { data: mo, error: moError } = await db
      .from("merchant_orders")
      .select("id")
      .eq("order_id", orderId)
      .single();
    if (moError) throw moError;
    merchantOrderId = mo.id;
  } else {
    merchantOrderId = merchantOrder.id;
    orderId = merchantOrder.order_id;
  }

  // Two more products, distinct from the one above, so there are enough
  // genuinely-reviewable (merchant_order_id, product_id) pairs to test the
  // review rate limiter against real, RLS-eligible inserts rather than
  // ones that would be rejected regardless (see tests/README.md).
  async function ensureReviewableProduct(name: string, sku: string): Promise<{ productId: string; variantId: string }> {
    let { data: existingProduct } = await db.from("products").select("id").eq("merchant_id", merchantA.id).eq("sku", sku).maybeSingle();
    if (existingProduct) {
      const { data: variant, error } = await db.from("product_variants").select("id").eq("product_id", existingProduct.id).single();
      if (error) throw error;
      return { productId: existingProduct.id, variantId: variant.id };
    }
    const productInsert = await db
      .from("products")
      .insert({
        merchant_id: merchantA.id,
        store_id: store.id,
        name,
        slug: `${sku.toLowerCase()}-${merchantA.id.slice(0, 8)}`,
        base_price: 50,
        sku,
        status: "published",
      })
      .select("id")
      .single();
    if (productInsert.error) throw productInsert.error;
    const variantInsert = await db
      .from("product_variants")
      .insert({ product_id: productInsert.data.id, sku: `${sku}-DEF`, attributes: {}, price: 50, is_default: true })
      .select("id")
      .single();
    if (variantInsert.error) throw variantInsert.error;
    await db.from("inventory").insert({ variant_id: variantInsert.data.id, stock_quantity: 999999, low_stock_threshold: 1 });
    return { productId: productInsert.data.id, variantId: variantInsert.data.id };
  }

  const reviewableA = await ensureReviewableProduct("QA TEST Reviewable Product A — DO NOT USE", "QA-TEST-REVIEW-A");
  const reviewableB = await ensureReviewableProduct("QA TEST Reviewable Product B — DO NOT USE", "QA-TEST-REVIEW-B");

  let { data: reviewableMerchantOrder } = await db
    .from("merchant_orders")
    .select("id, order_id")
    .eq("merchant_id", merchantA.id)
    .eq("status", "completed")
    .limit(1)
    .maybeSingle();

  let reviewableMerchantOrderId: string;
  if (!reviewableMerchantOrder) {
    const { data: newReviewableOrderId, error } = await db.rpc("create_order", {
      p_customer_id: customerUserId,
      p_address_id: address.id,
      p_items: [
        { variant_id: reviewableA.variantId, quantity: 1 },
        { variant_id: reviewableB.variantId, quantity: 1 },
      ],
    });
    if (error) throw error;
    const { data: mo, error: moError } = await db
      .from("merchant_orders")
      .select("id")
      .eq("order_id", newReviewableOrderId as string)
      .single();
    if (moError) throw moError;
    reviewableMerchantOrderId = mo.id;
    // Reviews require the order to be "completed" (0031_review_completion_check.sql)
    // — a real order goes through the whole delivery lifecycle to get
    // there, but for this fixture we only need the end state, not to
    // replay every intermediate status transition.
    const { error: updateError } = await db.from("merchant_orders").update({ status: "completed" }).eq("id", reviewableMerchantOrderId);
    if (updateError) throw updateError;
  } else {
    reviewableMerchantOrderId = reviewableMerchantOrder.id;
  }

  let { data: payment } = await db.from("payments").select("id").eq("order_id", orderId).maybeSingle();
  if (!payment) {
    const { data: order, error: orderError } = await db.from("orders").select("total").eq("id", orderId).single();
    if (orderError) throw orderError;
    const insertResult = await db
      .from("payments")
      .insert({ order_id: orderId, provider: "cash_on_delivery", amount: order.total, status: "pending" })
      .select("id")
      .single();
    if (insertResult.error) throw insertResult.error;
    payment = insertResult.data;
  }

  return {
    merchantAUserId,
    merchantAId: merchantA.id,
    merchantBUserId,
    merchantBId: merchantB.id,
    customerUserId,
    staffUserId,
    addressId: address.id,
    variantId,
    merchantOrderId,
    paymentId: payment.id,
    reviewableMerchantOrderId,
    reviewableProductAId: reviewableA.productId,
    reviewableProductBId: reviewableB.productId,
  };
}
