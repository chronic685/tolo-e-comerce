// Migration 0088 (customer order cancellation) run for real against in-process
// PGlite -- see pglite/harness.ts. Never touches any Supabase project.
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./pglite/harness.ts";

// The slice of the commerce schema 0080/0081/0088 reference (0005, 0007, 0010,
// 0029, 0041, 0065), at the columns used. release_stock is the real 0041 body.
const PRELUDE = /* sql */ `
create type merchant_order_status as enum ('new','accepted','rejected','processing','ready_for_pickup','picked_up','delivered','completed','cancelled');
create type delivery_status as enum ('pending','assigned','picked_up','in_transit','delivered','failed');
create type order_payment_status as enum ('pending','paid','failed','refunded');
create type order_item_status as enum ('active','removed','substituted');
create type inventory_movement_type as enum ('restock','sale','return','adjustment','reserve','release');
create table orders (id uuid primary key default gen_random_uuid(), customer_id uuid not null references profiles(id), payment_status order_payment_status not null default 'pending');
create table merchant_orders (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id),
  merchant_id uuid not null references merchants(id),
  status merchant_order_status not null default 'new'
);
create table order_status_history (
  id uuid primary key default gen_random_uuid(),
  merchant_order_id uuid not null references merchant_orders(id),
  status merchant_order_status not null,
  note text,
  changed_at timestamptz not null default now()
);
create table deliveries (
  id uuid primary key default gen_random_uuid(),
  merchant_order_id uuid not null unique references merchant_orders(id),
  status delivery_status not null default 'pending'
);
create table inventory (
  variant_id uuid primary key,
  stock_quantity int not null default 0 check (stock_quantity >= 0),
  reserved_quantity int not null default 0 check (reserved_quantity >= 0),
  constraint reserved_not_over_stock check (reserved_quantity <= stock_quantity)
);
create table inventory_movements (
  id uuid primary key default gen_random_uuid(),
  variant_id uuid not null,
  movement_type inventory_movement_type not null,
  quantity int not null,
  reference_type text,
  reference_id uuid,
  created_at timestamptz not null default now()
);
create table order_items (
  id uuid primary key default gen_random_uuid(),
  merchant_order_id uuid not null references merchant_orders(id),
  variant_id uuid not null,
  quantity int not null check (quantity > 0),
  item_status order_item_status not null default 'active'
);
create table notification_templates (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  channel text not null default 'in_app',
  language text not null default 'en',
  title_template text not null,
  body_template text not null,
  enabled boolean not null default true,
  unique (event_type, channel, language)
);
create function release_stock(p_variant_id uuid, p_quantity int, p_reference_id uuid, p_as_sale boolean default false)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_as_sale then
    update inventory set stock_quantity = stock_quantity - p_quantity, reserved_quantity = reserved_quantity - p_quantity where variant_id = p_variant_id;
    insert into inventory_movements (variant_id, movement_type, quantity, reference_type, reference_id) values (p_variant_id, 'sale', p_quantity, 'order', p_reference_id);
  else
    update inventory set reserved_quantity = reserved_quantity - p_quantity where variant_id = p_variant_id;
    insert into inventory_movements (variant_id, movement_type, quantity, reference_type, reference_id) values (p_variant_id, 'release', p_quantity, 'order', p_reference_id);
  end if;
end; $$;
create function order_owner_for_merchant_order(p_id uuid) returns uuid language sql stable security definer set search_path = public
as $$ select o.customer_id from merchant_orders mo join orders o on o.id = mo.order_id where mo.id = p_id $$;
create function merchant_id_for_merchant_order(p_id uuid) returns uuid language sql stable security definer set search_path = public
as $$ select merchant_id from merchant_orders where id = p_id $$;
create function is_merchant_member(p_merchant_id uuid) returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from merchants where id = p_merchant_id and owner_id = auth.uid()) $$;
create function has_admin_page(p_keys text[]) returns boolean language sql stable security definer set search_path = public
as $$ select false $$;
`;

let h: Harness;

beforeAll(async () => {
  h = await createHarness(["0080_delivery_jobs.sql", "0081_delivery_jobs_manual_handling.sql", "0088_customer_order_cancellation.sql"], { prelude: PRELUDE });
});

interface Setup {
  merchantOrderId: string;
  variantId: string;
  jobId: string | null;
}

/** An order with one item (qty 2). `paid` decides whether the stock is still a reservation or already a sale. */
async function setup(opts: { paid: boolean; orderStatus?: string; jobStatus?: string | null; removedItem?: boolean }): Promise<Setup> {
  const customer = await h.createAuthUser();
  const owner = await h.createAuthUser();
  const merchantId = randomUUID();
  await h.db.query("insert into merchants (id, owner_id, business_name) values ($1, $2, 'M')", [merchantId, owner.id]);
  const orderId = randomUUID();
  const merchantOrderId = randomUUID();
  const variantId = randomUUID();
  await h.db.query("insert into orders (id, customer_id, payment_status) values ($1, $2, $3)", [orderId, customer.id, opts.paid ? "paid" : "pending"]);
  await h.db.query("insert into merchant_orders (id, order_id, merchant_id, status) values ($1, $2, $3, $4)", [
    merchantOrderId,
    orderId,
    merchantId,
    opts.orderStatus ?? "new",
  ]);
  // 10 on the shelf. Unpaid: 2 reserved for this order. Paid: the 2 were already
  // sold (stock 8, nothing reserved by this order).
  await h.db.query("insert into inventory (variant_id, stock_quantity, reserved_quantity) values ($1, $2, $3)", [variantId, opts.paid ? 8 : 10, opts.paid ? 0 : 2]);
  await h.db.query("insert into order_items (merchant_order_id, variant_id, quantity, item_status) values ($1, $2, 2, $3)", [
    merchantOrderId,
    variantId,
    opts.removedItem ? "removed" : "active",
  ]);
  await h.db.query("insert into deliveries (merchant_order_id, status) values ($1, 'assigned')", [merchantOrderId]);
  let jobId: string | null = null;
  if (opts.jobStatus) {
    const { rows } = await h.db.query<{ id: string }>("insert into delivery_jobs (merchant_order_id, status) values ($1, $2) returning id", [merchantOrderId, opts.jobStatus]);
    jobId = rows[0].id;
  }
  return { merchantOrderId, variantId, jobId };
}

function cancel(merchantOrderId: string) {
  return h.asService((tx) => tx.query("select cancel_order_fulfilment($1)", [merchantOrderId]));
}

async function inv(variantId: string) {
  const { rows } = await h.db.query<{ stock_quantity: number; reserved_quantity: number }>("select stock_quantity, reserved_quantity from inventory where variant_id = $1", [variantId]);
  return rows[0];
}

async function jobRow(merchantOrderId: string) {
  const { rows } = await h.db.query<{ status: string; cancelled_at: string | null }>("select status, cancelled_at from delivery_jobs where merchant_order_id = $1", [merchantOrderId]);
  return rows[0];
}

async function deliveryStatus(merchantOrderId: string) {
  const { rows } = await h.db.query<{ status: string }>("select status from deliveries where merchant_order_id = $1", [merchantOrderId]);
  return rows[0].status;
}

describe("cancel_order_fulfilment: stock", () => {
  it("gives an unpaid order's reservation back (release_stock), leaving stock_quantity alone", async () => {
    const s = await setup({ paid: false });
    await cancel(s.merchantOrderId);
    expect(await inv(s.variantId)).toEqual({ stock_quantity: 10, reserved_quantity: 0 });
    const { rows } = await h.db.query("select movement_type from inventory_movements where variant_id = $1", [s.variantId]);
    expect(rows).toEqual([{ movement_type: "release" }]);
  });

  it("puts a paid order's sold units back on the shelf without touching reservations", async () => {
    const s = await setup({ paid: true });
    // Another customer's reservation on the same variant must survive.
    await h.db.query("update inventory set reserved_quantity = 3 where variant_id = $1", [s.variantId]);
    await cancel(s.merchantOrderId);
    expect(await inv(s.variantId)).toEqual({ stock_quantity: 10, reserved_quantity: 3 });
    const { rows } = await h.db.query("select movement_type, quantity from inventory_movements where variant_id = $1", [s.variantId]);
    expect(rows).toEqual([{ movement_type: "restock", quantity: 2 }]);
  });

  it("skips items already removed at fulfilment (their stock went back when they were removed)", async () => {
    const s = await setup({ paid: false, removedItem: true });
    await h.db.query("update inventory set reserved_quantity = 0 where variant_id = $1", [s.variantId]);
    await cancel(s.merchantOrderId);
    expect(await inv(s.variantId)).toEqual({ stock_quantity: 10, reserved_quantity: 0 });
    const { rows } = await h.db.query("select 1 from inventory_movements where variant_id = $1", [s.variantId]);
    expect(rows).toEqual([]);
  });

  it("never releases more than is actually reserved", async () => {
    const s = await setup({ paid: false });
    await h.db.query("update inventory set reserved_quantity = 1 where variant_id = $1", [s.variantId]);
    await cancel(s.merchantOrderId);
    expect((await inv(s.variantId)).reserved_quantity).toBe(0);
  });
});

describe("cancel_order_fulfilment: delivery", () => {
  it("cancels an invoked job and its deliveries row", async () => {
    const s = await setup({ paid: true, orderStatus: "ready_for_pickup", jobStatus: "invoked" });
    await cancel(s.merchantOrderId);
    const job = await jobRow(s.merchantOrderId);
    expect(job.status).toBe("cancelled");
    expect(job.cancelled_at).not.toBeNull();
    expect(await deliveryStatus(s.merchantOrderId)).toBe("cancelled");
  });

  it("cancels an accepted job too (a driver is assigned but has not picked up)", async () => {
    const s = await setup({ paid: true, orderStatus: "ready_for_pickup", jobStatus: "accepted" });
    await cancel(s.merchantOrderId);
    expect((await jobRow(s.merchantOrderId)).status).toBe("cancelled");
  });

  it("leaves a picked_up job alone", async () => {
    const s = await setup({ paid: true, orderStatus: "picked_up", jobStatus: "picked_up" });
    await h.db.query("update deliveries set status = 'picked_up' where merchant_order_id = $1", [s.merchantOrderId]);
    await cancel(s.merchantOrderId);
    expect((await jobRow(s.merchantOrderId)).status).toBe("picked_up");
    expect(await deliveryStatus(s.merchantOrderId)).toBe("picked_up");
  });

  it("works for an order that never reached the handoff (no job)", async () => {
    const s = await setup({ paid: false, jobStatus: null });
    await expect(cancel(s.merchantOrderId)).resolves.toBeDefined();
  });
});

describe("apply_delivery_job_update on a cancelled job", () => {
  it("refuses any late callback, including failed", async () => {
    const s = await setup({ paid: true, orderStatus: "ready_for_pickup", jobStatus: "invoked" });
    await cancel(s.merchantOrderId);
    for (const status of ["accepted", "picked_up", "delivered", "failed"]) {
      await expect(
        h.asService((tx) => tx.query("select * from apply_delivery_job_update($1, $2, 'driver-1', null, null)", [s.jobId, status])),
      ).rejects.toThrow(/invalid_transition/);
    }
    expect((await jobRow(s.merchantOrderId)).status).toBe("cancelled");
  });
});

describe("permissions and templates", () => {
  it("is callable by service_role only", async () => {
    const s = await setup({ paid: false });
    const user = await h.createAuthUser();
    await expect(h.asUser(user.id, (tx) => tx.query("select cancel_order_fulfilment($1)", [s.merchantOrderId]))).rejects.toThrow(/permission denied/);
  });

  it("adds the merchant-facing template", async () => {
    const { rows } = await h.db.query("select 1 from notification_templates where event_type = 'order_cancelled_by_customer'");
    expect(rows).toHaveLength(1);
  });
});
