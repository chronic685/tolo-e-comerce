// Migration 0080 (delivery_jobs) run for real against in-process PGlite --
// see tests/pglite/harness.ts. Never touches any Supabase project.
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { createHarness, type Harness, type TestUser } from "./pglite/harness.ts";

// The slice of the commerce schema the migration references (0007, 0010,
// 0013, 0051), at the columns it uses, plus the RLS helpers as defined there.
const PRELUDE = /* sql */ `
create type merchant_order_status as enum ('new','accepted','rejected','processing','ready_for_pickup','picked_up','delivered','completed','cancelled');
create type delivery_status as enum ('pending','assigned','picked_up','in_transit','delivered','failed');
create table orders (id uuid primary key default gen_random_uuid(), customer_id uuid not null references profiles(id));
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
create function order_owner_for_merchant_order(p_id uuid) returns uuid language sql stable security definer set search_path = public
as $$ select o.customer_id from merchant_orders mo join orders o on o.id = mo.order_id where mo.id = p_id $$;
create function merchant_id_for_merchant_order(p_id uuid) returns uuid language sql stable security definer set search_path = public
as $$ select merchant_id from merchant_orders where id = p_id $$;
create function is_merchant_member(p_merchant_id uuid) returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from merchants where id = p_merchant_id and owner_id = auth.uid()) $$;
create function has_admin_page(p_keys text[]) returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from profiles where id = auth.uid() and account_status = 'active' and (admin_tier is not null or (role like 'tolo\\_%' and permissions ?| p_keys))) $$;
`;

let h: Harness;

beforeAll(async () => {
  h = await createHarness(["0080_delivery_jobs.sql", "0081_delivery_jobs_manual_handling.sql"], { prelude: PRELUDE });
});

interface Setup {
  customer: TestUser;
  merchantOwner: TestUser;
  merchantOrderId: string;
  jobId: string;
}

async function newMerchant(owner: TestUser): Promise<string> {
  const id = randomUUID();
  await h.db.query("insert into merchants (id, owner_id, business_name) values ($1, $2, 'Test Merchant')", [id, owner.id]);
  return id;
}

/** A customer's order at ready_for_pickup with a job (and a deliveries row), as the handoff leaves it. */
async function setup(status = "ready_for_pickup"): Promise<Setup> {
  const customer = await h.createAuthUser();
  const merchantOwner = await h.createAuthUser();
  const merchantId = await newMerchant(merchantOwner);
  const orderId = randomUUID();
  const merchantOrderId = randomUUID();
  await h.db.query("insert into orders (id, customer_id) values ($1, $2)", [orderId, customer.id]);
  await h.db.query("insert into merchant_orders (id, order_id, merchant_id, status) values ($1, $2, $3, $4)", [
    merchantOrderId,
    orderId,
    merchantId,
    status,
  ]);
  await h.db.query("insert into deliveries (merchant_order_id) values ($1)", [merchantOrderId]);
  const { rows } = await h.db.query<{ id: string }>("insert into delivery_jobs (merchant_order_id) values ($1) returning id", [merchantOrderId]);
  return { customer, merchantOwner, merchantOrderId, jobId: rows[0].id };
}

function apply(jobId: string, status: string, opts: { driver?: string | null; eta?: number | null; reason?: string | null } = {}) {
  return h.asService((tx) =>
    tx.query<{ outcome: string; merchant_order_id: string }>("select * from apply_delivery_job_update($1, $2, $3, $4, $5)", [
      jobId,
      status,
      opts.driver ?? null,
      opts.eta ?? null,
      opts.reason ?? null,
    ]),
  );
}

async function job(jobId: string) {
  const { rows } = await h.db.query<Record<string, unknown>>("select * from delivery_jobs where id = $1", [jobId]);
  return rows[0];
}

async function orderStatus(merchantOrderId: string): Promise<string> {
  const { rows } = await h.db.query<{ status: string }>("select status from merchant_orders where id = $1", [merchantOrderId]);
  return rows[0].status;
}

describe("delivery_jobs table", () => {
  it("defaults to invoked, and one merchant order can only ever have one job", async () => {
    const s = await setup();
    expect((await job(s.jobId)).status).toBe("invoked");
    await expect(h.db.query("insert into delivery_jobs (merchant_order_id) values ($1)", [s.merchantOrderId])).rejects.toThrow(/unique/i);
  });

  it("is not flagged for manual handling by default", async () => {
    const s = await setup();
    expect((await job(s.jobId)).needs_manual_handling).toBe(false);
  });

  it("only allows the five documented statuses", async () => {
    const s = await setup();
    await expect(h.db.query("update delivery_jobs set status = 'in_transit' where id = $1", [s.jobId])).rejects.toThrow(/invalid input value/);
  });
});

describe("delivery_jobs RLS", () => {
  it("lets the customer who owns the order read its job", async () => {
    const s = await setup();
    const { rows } = await h.asUser(s.customer.id, (tx) => tx.query("select id from delivery_jobs"));
    expect(rows).toHaveLength(1);
  });

  it("does not let another customer read it", async () => {
    const s = await setup();
    const stranger = await h.createAuthUser();
    const { rows } = await h.asUser(stranger.id, (tx) => tx.query("select id from delivery_jobs where id = $1", [s.jobId]));
    expect(rows).toEqual([]);
  });

  it("lets the merchant that owns the order read it, and no other merchant", async () => {
    const s = await setup();
    const own = await h.asUser(s.merchantOwner.id, (tx) => tx.query("select id from delivery_jobs where id = $1", [s.jobId]));
    expect(own.rows).toHaveLength(1);

    const otherOwner = await h.createAuthUser();
    await newMerchant(otherOwner);
    const other = await h.asUser(otherOwner.id, (tx) => tx.query("select id from delivery_jobs where id = $1", [s.jobId]));
    expect(other.rows).toEqual([]);
  });

  it("lets an admin read every job", async () => {
    const a = await setup();
    const b = await setup();
    const admin = await h.createAuthUser({ adminTier: "admin" });
    const { rows } = await h.asUser(admin.id, (tx) => tx.query<{ id: string }>("select id from delivery_jobs"));
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(a.jobId);
    expect(ids).toContain(b.jobId);
  });

  it("lets Orders-page staff read jobs, but not staff without that page", async () => {
    const s = await setup();
    const ordersStaff = await h.createAuthUser({ role: "tolo_ops" });
    await h.db.query("update profiles set permissions = '[\"orders\"]'::jsonb where id = $1", [ordersStaff.id]);
    const other = await h.createAuthUser({ role: "tolo_ops" });
    await h.db.query("update profiles set permissions = '[\"support\"]'::jsonb where id = $1", [other.id]);
    expect((await h.asUser(ordersStaff.id, (tx) => tx.query("select id from delivery_jobs where id = $1", [s.jobId]))).rows).toHaveLength(1);
    expect((await h.asUser(other.id, (tx) => tx.query("select id from delivery_jobs where id = $1", [s.jobId]))).rows).toEqual([]);
  });

  it("shows nothing to anon", async () => {
    await setup();
    await expect(h.asAnon((tx) => tx.query("select id from delivery_jobs"))).rejects.toThrow(/permission denied/);
  });

  it("gives nobody a write path, not even the customer or merchant who can read the row", async () => {
    const s = await setup();
    for (const user of [s.customer, s.merchantOwner]) {
      await expect(h.asUser(user.id, (tx) => tx.query("update delivery_jobs set status = 'delivered' where id = $1", [s.jobId]))).rejects.toThrow(
        /permission denied/,
      );
      await expect(h.asUser(user.id, (tx) => tx.query("delete from delivery_jobs where id = $1", [s.jobId]))).rejects.toThrow(/permission denied/);
      await expect(
        h.asUser(user.id, (tx) => tx.query("insert into delivery_jobs (merchant_order_id) values ($1)", [randomUUID()])),
      ).rejects.toThrow(/permission denied/);
    }
    expect((await job(s.jobId)).status).toBe("invoked");
  });
});

describe("apply_delivery_job_update", () => {
  it("is not callable by users or anon", async () => {
    const s = await setup();
    await expect(
      h.asUser(s.customer.id, (tx) => tx.query("select * from apply_delivery_job_update($1, 'delivered', 'x')", [s.jobId])),
    ).rejects.toThrow(/permission denied/);
    await expect(h.asAnon((tx) => tx.query("select * from apply_delivery_job_update($1, 'delivered', 'x')", [s.jobId]))).rejects.toThrow(
      /permission denied/,
    );
  });

  it("walks accepted -> picked_up -> delivered, mirroring onto the order, deliveries and history", async () => {
    const s = await setup();

    const accepted = await apply(s.jobId, "accepted", { driver: "drv-42", eta: 25 });
    expect(accepted.rows[0]).toEqual({ outcome: "applied", merchant_order_id: s.merchantOrderId });
    let j = await job(s.jobId);
    expect(j).toMatchObject({ status: "accepted", driver_ref: "drv-42" });
    expect(j.accepted_at).not.toBeNull();
    expect(j.eta_at).not.toBeNull();
    expect(await orderStatus(s.merchantOrderId)).toBe("ready_for_pickup");

    await apply(s.jobId, "picked_up");
    expect(await orderStatus(s.merchantOrderId)).toBe("picked_up");

    await apply(s.jobId, "delivered");
    j = await job(s.jobId);
    expect(j).toMatchObject({ status: "delivered", driver_ref: "drv-42", eta_at: null });
    expect(j.delivered_at).not.toBeNull();
    expect(await orderStatus(s.merchantOrderId)).toBe("completed");

    const { rows: history } = await h.db.query<{ status: string }>(
      "select status from order_status_history where merchant_order_id = $1 order by changed_at, status",
      [s.merchantOrderId],
    );
    expect(history.map((r) => r.status).sort()).toEqual(["completed", "delivered", "picked_up"]);
    const { rows: deliveries } = await h.db.query<{ status: string }>("select status from deliveries where merchant_order_id = $1", [s.merchantOrderId]);
    expect(deliveries[0].status).toBe("delivered");
  });

  it("the customer sees the mirrored status through their own RLS access", async () => {
    const s = await setup();
    await apply(s.jobId, "accepted", { driver: "drv-1" });
    const { rows } = await h.asUser(s.customer.id, (tx) =>
      tx.query<{ status: string; driver_ref: string }>("select status, driver_ref from delivery_jobs where id = $1", [s.jobId]),
    );
    expect(rows).toEqual([{ status: "accepted", driver_ref: "drv-1" }]);
  });

  it("treats a repeated status as a no-op", async () => {
    const s = await setup();
    await apply(s.jobId, "accepted", { driver: "drv-1" });
    const again = await apply(s.jobId, "accepted", { driver: "drv-1" });
    expect(again.rows[0].outcome).toBe("unchanged");
  });

  it("lets an accepted job be reassigned or get a fresh ETA", async () => {
    const s = await setup();
    await apply(s.jobId, "accepted", { driver: "drv-1" });
    expect((await apply(s.jobId, "accepted", { driver: "drv-2" })).rows[0].outcome).toBe("applied");
    expect((await job(s.jobId)).driver_ref).toBe("drv-2");
    expect((await apply(s.jobId, "accepted", { eta: 10 })).rows[0].outcome).toBe("applied");
  });

  it("refuses to go backwards", async () => {
    const s = await setup();
    await apply(s.jobId, "accepted", { driver: "drv-1" });
    await apply(s.jobId, "picked_up");
    await expect(apply(s.jobId, "accepted")).rejects.toThrow("invalid_transition");
    expect((await job(s.jobId)).status).toBe("picked_up");
  });

  it("treats delivered and failed as final", async () => {
    const delivered = await setup();
    await apply(delivered.jobId, "accepted", { driver: "d" });
    await apply(delivered.jobId, "delivered");
    await expect(apply(delivered.jobId, "failed")).rejects.toThrow("invalid_transition");
    expect((await apply(delivered.jobId, "delivered")).rows[0].outcome).toBe("unchanged");

    const failed = await setup();
    await apply(failed.jobId, "failed", { reason: "customer unreachable" });
    await expect(apply(failed.jobId, "accepted", { driver: "d" })).rejects.toThrow("invalid_transition");
  });

  it("records a failure with its reason and leaves the order where it was", async () => {
    const s = await setup();
    await apply(s.jobId, "accepted", { driver: "drv-1" });
    await apply(s.jobId, "failed", { reason: "customer unreachable", eta: 5 });
    expect(await job(s.jobId)).toMatchObject({ status: "failed", failure_reason: "customer unreachable", eta_at: null });
    expect(await orderStatus(s.merchantOrderId)).toBe("ready_for_pickup");
  });

  it("needs a driver reference by the time a driver is involved", async () => {
    const s = await setup();
    await expect(apply(s.jobId, "accepted")).rejects.toThrow("driver_ref_required");
    await expect(apply(s.jobId, "picked_up")).rejects.toThrow("driver_ref_required");
    await apply(s.jobId, "failed"); // no driver needed to fail
  });

  it("never lets a callback set the invoked status, or touch an unknown job", async () => {
    const s = await setup();
    await expect(apply(s.jobId, "invoked")).rejects.toThrow("invalid_status");
    await expect(apply(randomUUID(), "accepted", { driver: "x" })).rejects.toThrow("job_not_found");
  });

  it("does not resurrect an order that was cancelled in the meantime", async () => {
    const s = await setup("cancelled");
    await apply(s.jobId, "accepted", { driver: "drv-1" });
    await apply(s.jobId, "picked_up");
    await apply(s.jobId, "delivered");
    expect(await orderStatus(s.merchantOrderId)).toBe("cancelled");
    const { rows } = await h.db.query("select 1 from order_status_history where merchant_order_id = $1", [s.merchantOrderId]);
    expect(rows).toEqual([]);
  });
});
