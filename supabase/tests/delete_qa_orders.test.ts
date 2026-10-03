// Migrations 0082-0083 (delete_qa_orders) run for real against in-process PGlite --
// see tests/pglite/harness.ts. Never touches any Supabase project.
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./pglite/harness.ts";

// The slice of the commerce schema the function touches (0005, 0007, 0008,
// 0009, 0011, 0025, 0029, 0056), at the columns it uses, with the same
// foreign keys and delete rules the real tables have.
const PRELUDE = /* sql */ `
alter table merchants add column is_test boolean not null default false;
create type merchant_order_status as enum ('new','accepted','rejected','processing','ready_for_pickup','picked_up','delivered','completed','cancelled');
create type payment_status as enum ('pending','verified','failed','refunded');
create type inventory_movement_type as enum ('restock','sale','return','adjustment','reserve','release');
create sequence order_number_seq start 4300;
create table orders (id uuid primary key default gen_random_uuid(), customer_id uuid not null references profiles(id), order_number int not null default nextval('order_number_seq'));
create table merchant_orders (id uuid primary key default gen_random_uuid(), order_id uuid not null references orders(id) on delete cascade, merchant_id uuid not null references merchants(id), status merchant_order_status not null default 'new');
create table order_items (id uuid primary key default gen_random_uuid(), merchant_order_id uuid not null references merchant_orders(id) on delete cascade);
create table payments (id uuid primary key default gen_random_uuid(), order_id uuid not null references orders(id) on delete cascade, status payment_status not null default 'pending');
create table payment_transactions (id uuid primary key default gen_random_uuid(), payment_id uuid not null references payments(id) on delete cascade);
create table delivery_jobs (id uuid primary key default gen_random_uuid(), merchant_order_id uuid not null unique references merchant_orders(id) on delete cascade);
create table wallet_transactions (id uuid primary key default gen_random_uuid(), merchant_order_id uuid references merchant_orders(id));
create table settlement_items (id uuid primary key default gen_random_uuid(), merchant_order_id uuid references merchant_orders(id));
create table financial_adjustments (id uuid primary key default gen_random_uuid(), order_id uuid references orders(id));
create table discount_redemptions (id uuid primary key default gen_random_uuid(), order_id uuid references orders(id));
create table reviews (id uuid primary key default gen_random_uuid(), merchant_order_id uuid references merchant_orders(id) on delete cascade);
create table returns (id uuid primary key default gen_random_uuid(), merchant_order_id uuid references merchant_orders(id) on delete cascade);
create table support_tickets (id uuid primary key default gen_random_uuid(), merchant_order_id uuid references merchant_orders(id) on delete set null);
create table notifications (id uuid primary key default gen_random_uuid(), user_id uuid not null references profiles(id), type text not null, body text not null);
create table inventory (variant_id uuid primary key, stock_quantity int not null default 0, reserved_quantity int not null default 0 check (reserved_quantity >= 0));
create table inventory_movements (id uuid primary key default gen_random_uuid(), variant_id uuid not null, movement_type inventory_movement_type not null, quantity int not null, reference_type text, reference_id uuid);
-- release_stock(): the non-sale branch of migration 0005/0041.
create function release_stock(p_variant_id uuid, p_quantity int, p_reference_id uuid, p_as_sale boolean default false) returns void language plpgsql as $$
begin
  update inventory set reserved_quantity = reserved_quantity - p_quantity where variant_id = p_variant_id;
  insert into inventory_movements (variant_id, movement_type, quantity, reference_type, reference_id) values (p_variant_id, 'release', p_quantity, 'order', p_reference_id);
end $$;
`;

let h: Harness;
const variant = randomUUID();

beforeAll(async () => {
  h = await createHarness(["0082_delete_qa_orders.sql", "0083_delete_qa_orders_bulk.sql"], { prelude: PRELUDE });
  await h.db.query("insert into inventory (variant_id, stock_quantity, reserved_quantity) values ($1, 100, 0)", [variant]);
});

interface Order {
  orderId: string;
  moId: string;
  number: number;
  customerId: string;
}

/** An order at ready_for_pickup holding 2 reserved units, with its notifications. */
async function order(opts: { isTest?: boolean } = {}): Promise<Order> {
  const customer = await h.createAuthUser();
  const owner = await h.createAuthUser();
  const merchantId = randomUUID();
  await h.db.query("insert into merchants (id, owner_id, business_name, is_test) values ($1, $2, 'M', $3)", [merchantId, owner.id, opts.isTest ?? true]);
  const orderId = randomUUID();
  const moId = randomUUID();
  const { rows } = await h.db.query<{ order_number: number }>("insert into orders (id, customer_id) values ($1, $2) returning order_number", [orderId, customer.id]);
  const number = rows[0].order_number;
  await h.db.query("insert into merchant_orders (id, order_id, merchant_id, status) values ($1, $2, $3, 'ready_for_pickup')", [moId, orderId, merchantId]);
  await h.db.query("insert into order_items (merchant_order_id) values ($1)", [moId]);
  await h.db.query("insert into payments (order_id) values ($1)", [orderId]);
  await h.db.query("insert into delivery_jobs (merchant_order_id) values ($1)", [moId]);
  await h.db.query("update inventory set reserved_quantity = reserved_quantity + 2 where variant_id = $1", [variant]);
  await h.db.query("insert into inventory_movements (variant_id, movement_type, quantity, reference_type, reference_id) values ($1, 'reserve', 2, 'order', $2)", [variant, orderId]);
  for (const type of ["order_received", "order_ready_for_pickup"]) {
    await h.db.query("insert into notifications (user_id, type, body) values ($1, $2, $3)", [customer.id, type, `Order TL-${number} is on its way`]);
  }
  return { orderId, moId, number, customerId: customer.id };
}

const del = (ids: string[], skipIneligible = false) =>
  h.asService((tx) =>
    tx.query<{ orders_deleted: number; notifications_deleted: number; reservations_released: number; orders_skipped: number }>(
      "select * from delete_qa_orders($1, $2)",
      [ids, skipIneligible],
    ),
  );
const count = async (sql: string, ...args: unknown[]) => Number((await h.db.query<{ n: string }>(sql, args)).rows[0].n);
const reserved = async () =>
  (await h.db.query<{ reserved_quantity: number }>("select reserved_quantity from inventory where variant_id = $1", [variant])).rows[0].reserved_quantity;

describe("delete_qa_orders", () => {
  it("removes the orders and everything hanging off them, and gives the reserved stock back", async () => {
    const a = await order();
    const b = await order();
    const bystander = await order();
    const before = await reserved();

    const { rows } = await del([a.orderId, b.orderId]);
    expect(rows[0]).toEqual({ orders_deleted: 2, notifications_deleted: 4, reservations_released: 4, orders_skipped: 0 });

    for (const o of [a, b]) {
      expect(await count("select count(*) n from orders where id = $1", o.orderId)).toBe(0);
      expect(await count("select count(*) n from merchant_orders where order_id = $1", o.orderId)).toBe(0);
      expect(await count("select count(*) n from order_items where merchant_order_id = $1", o.moId)).toBe(0);
      expect(await count("select count(*) n from payments where order_id = $1", o.orderId)).toBe(0);
      expect(await count("select count(*) n from delivery_jobs where merchant_order_id = $1", o.moId)).toBe(0);
      expect(await count("select count(*) n from inventory_movements where reference_id = $1", o.orderId)).toBe(0);
      expect(await count("select count(*) n from notifications where user_id = $1", o.customerId)).toBe(0);
    }
    expect(await reserved()).toBe(before - 4);

    // The order that wasn't named is untouched, notifications included.
    expect(await count("select count(*) n from orders where id = $1", bystander.orderId)).toBe(1);
    expect(await count("select count(*) n from notifications where user_id = $1", bystander.customerId)).toBe(2);
  });

  it("only deletes the notifications for that order number, not the customer's others", async () => {
    const a = await order();
    await h.db.query("insert into notifications (user_id, type, body) values ($1, 'order_received', 'Order TL-99999 elsewhere')", [a.customerId]);
    await h.db.query("insert into notifications (user_id, type, body) values ($1, 'promo', $2)", [a.customerId, `unrelated, mentions TL-${a.number}`]);
    await del([a.orderId]);
    const { rows } = await h.db.query<{ body: string }>("select body from notifications where user_id = $1 order by body", [a.customerId]);
    expect(rows.map((r) => r.body)).toEqual(["Order TL-99999 elsewhere", `unrelated, mentions TL-${a.number}`]);
  });

  it("is not callable by users or anon", async () => {
    const a = await order();
    const user = await h.createAuthUser();
    await expect(h.asUser(user.id, (tx) => tx.query("select * from delete_qa_orders($1, false)", [[a.orderId]]))).rejects.toThrow(/permission denied/);
    await expect(h.asAnon((tx) => tx.query("select * from delete_qa_orders($1, false)", [[a.orderId]]))).rejects.toThrow(/permission denied/);
    expect(await count("select count(*) n from orders where id = $1", a.orderId)).toBe(1);
  });

  it("refuses a real merchant's order", async () => {
    const real = await order({ isTest: false });
    await expect(del([real.orderId])).rejects.toThrow("not_a_test_order");
    expect(await count("select count(*) n from orders where id = $1", real.orderId)).toBe(1);
  });

  it("refuses the whole batch if any order is unknown or real, deleting none", async () => {
    const qa = await order();
    const real = await order({ isTest: false });
    await expect(del([qa.orderId, real.orderId])).rejects.toThrow("not_a_test_order");
    await expect(del([qa.orderId, randomUUID()])).rejects.toThrow("order_not_found");
    await expect(del([])).rejects.toThrow("no_orders");
    expect(await count("select count(*) n from orders where id = $1", qa.orderId)).toBe(1);
  });

  it.each([
    ["wallet_transactions", "insert into wallet_transactions (merchant_order_id) values ($1)", "mo"],
    ["settlement_items", "insert into settlement_items (merchant_order_id) values ($1)", "mo"],
    ["financial_adjustments", "insert into financial_adjustments (order_id) values ($1)", "order"],
    ["discount_redemptions", "insert into discount_redemptions (order_id) values ($1)", "order"],
    ["reviews", "insert into reviews (merchant_order_id) values ($1)", "mo"],
    ["returns", "insert into returns (merchant_order_id) values ($1)", "mo"],
    ["support_tickets", "insert into support_tickets (merchant_order_id) values ($1)", "mo"],
  ])("refuses, and deletes nothing, when %s refers to the order", async (_name, sql, key) => {
    const a = await order();
    await h.db.query(sql, [key === "mo" ? a.moId : a.orderId]);
    await expect(del([a.orderId])).rejects.toThrow("has_references");
    expect(await count("select count(*) n from orders where id = $1", a.orderId)).toBe(1);
    expect(await count("select count(*) n from notifications where user_id = $1", a.customerId)).toBe(2);
  });

  it("refuses an order with a settled payment or payment transactions", async () => {
    const verified = await order();
    await h.db.query("update payments set status = 'verified' where order_id = $1", [verified.orderId]);
    await expect(del([verified.orderId])).rejects.toThrow("payment_settled");

    const withTxn = await order();
    await h.db.query("insert into payment_transactions (payment_id) select id from payments where order_id = $1", [withTxn.orderId]);
    await expect(del([withTxn.orderId])).rejects.toThrow("payment_settled");
  });

  it("refuses an order whose stock was already sold, leaving the reservation alone", async () => {
    const a = await order();
    await h.db.query(
      "insert into inventory_movements (variant_id, movement_type, quantity, reference_type, reference_id) values ($1, 'sale', 2, 'order', $2)",
      [variant, a.orderId],
    );
    const before = await reserved();
    await expect(del([a.orderId])).rejects.toThrow("stock_already_sold");
    expect(await reserved()).toBe(before);
  });

  describe("bulk mode (p_skip_ineligible)", () => {
    it("checks every order individually, deleting the eligible ones and skipping each ineligible one", async () => {
      const ok1 = await order();
      const ok2 = await order();
      const real = await order({ isTest: false });
      const withWallet = await order();
      await h.db.query("insert into wallet_transactions (merchant_order_id) values ($1)", [withWallet.moId]);
      const settled = await order();
      await h.db.query("update payments set status = 'verified' where order_id = $1", [settled.orderId]);
      const sold = await order();
      await h.db.query(
        "insert into inventory_movements (variant_id, movement_type, quantity, reference_type, reference_id) values ($1, 'sale', 2, 'order', $2)",
        [variant, sold.orderId],
      );
      const before = await reserved();

      const { rows } = await del([ok1.orderId, ok2.orderId, real.orderId, withWallet.orderId, settled.orderId, sold.orderId, randomUUID()], true);
      expect(rows[0]).toEqual({ orders_deleted: 2, notifications_deleted: 4, reservations_released: 4, orders_skipped: 5 });

      for (const gone of [ok1, ok2]) expect(await count("select count(*) n from orders where id = $1", gone.orderId)).toBe(0);
      for (const kept of [real, withWallet, settled, sold]) {
        expect(await count("select count(*) n from orders where id = $1", kept.orderId)).toBe(1);
        expect(await count("select count(*) n from notifications where user_id = $1", kept.customerId)).toBe(2);
      }
      expect(await reserved()).toBe(before - 4);
    });

    it("deletes nothing and reports the skips when no order is eligible", async () => {
      const real = await order({ isTest: false });
      const { rows } = await del([real.orderId], true);
      expect(rows[0]).toEqual({ orders_deleted: 0, notifications_deleted: 0, reservations_released: 0, orders_skipped: 1 });
      expect(await count("select count(*) n from orders where id = $1", real.orderId)).toBe(1);
    });

    it("still refuses an empty request", async () => {
      await expect(del([], true)).rejects.toThrow("no_orders");
    });
  });

  it("qa_order_blocker names why an order can't be deleted, and is not callable by users", async () => {
    const ok = await order();
    const real = await order({ isTest: false });
    const q = (id: string) => h.asService((tx) => tx.query<{ b: string | null }>("select qa_order_blocker($1) b", [id]));
    expect((await q(ok.orderId)).rows[0].b).toBeNull();
    expect((await q(real.orderId)).rows[0].b).toBe("not_a_test_order");
    expect((await q(randomUUID())).rows[0].b).toBe("order_not_found");
    const user = await h.createAuthUser();
    await expect(h.asUser(user.id, (tx) => tx.query("select qa_order_blocker($1)", [ok.orderId]))).rejects.toThrow(/permission denied/);
  });
});
