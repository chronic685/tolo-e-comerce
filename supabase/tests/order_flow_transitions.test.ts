// Migration 0098 (legal order status transitions, enforced for every client write) against in-process PGlite --
// see pglite/harness.ts. Never touches any Supabase project.
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { createHarness, type Harness, type TestUser } from "./pglite/harness.ts";

const STATUSES = ["new", "accepted", "rejected", "processing", "ready_for_pickup", "picked_up", "delivered", "completed", "cancelled"] as const;

// The merchant's own legal moves and the customer's, exactly as the migration header lists them.
const MERCHANT_LEGAL = new Set([
  "new>processing", "new>accepted", "new>rejected",
  "accepted>processing", "accepted>cancelled",
  "processing>ready_for_pickup", "processing>cancelled",
  "ready_for_pickup>picked_up", "ready_for_pickup>cancelled",
]);
const CUSTOMER_FROM = new Set(["new", "accepted", "processing", "ready_for_pickup"]);

const PRELUDE = /* sql */ `
create type merchant_order_status as enum ('new','accepted','rejected','processing','ready_for_pickup','picked_up','delivered','completed','cancelled');
create table notification_templates (
  id uuid primary key default gen_random_uuid(), event_type text not null, channel text not null default 'in_app',
  language text not null default 'en', title_template text not null, body_template text not null, enabled boolean not null default true,
  unique (event_type, channel, language)
);
create table merchant_staff (merchant_id uuid not null references merchants(id) on delete cascade, user_id uuid not null references profiles(id) on delete cascade);
create function is_merchant_member(p_merchant_id uuid) returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from merchants where id = p_merchant_id and owner_id = auth.uid())
   or exists (select 1 from merchant_staff where merchant_id = p_merchant_id and user_id = auth.uid()) $$;
create table orders (id uuid primary key default gen_random_uuid(), customer_id uuid not null references profiles(id));
create table merchant_orders (
  id uuid primary key default gen_random_uuid(), order_id uuid not null references orders(id),
  merchant_id uuid not null references merchants(id), status merchant_order_status not null default 'new'
);
create function order_owner_for_merchant_order(p_id uuid) returns uuid language sql stable security definer set search_path = public
as $$ select o.customer_id from merchant_orders mo join orders o on o.id = mo.order_id where mo.id = p_id $$;
-- merchant_orders RLS as 0014/0051 left it: the merchant's members and the order's owner can read and update rows.
alter table merchant_orders enable row level security;
create policy merchant_orders_select on merchant_orders for select using (is_merchant_member(merchant_id) or order_owner_for_merchant_order(id) = auth.uid() or is_tolo_admin());
create policy merchant_orders_update on merchant_orders for update using (is_merchant_member(merchant_id) or order_owner_for_merchant_order(id) = auth.uid() or is_tolo_admin());
`;

let h: Harness;
let merchantOwner: TestUser;
let merchantStaffMember: TestUser;
let rivalOwner: TestUser;
let customer: TestUser;
let stranger: TestUser;
let admin: TestUser;
let merchantId: string;
let rivalMerchantId: string;

beforeAll(async () => {
  h = await createHarness(["0098_order_flow_one_button.sql"], { prelude: PRELUDE });
  [merchantOwner, merchantStaffMember, rivalOwner, customer, stranger] = [
    await h.createAuthUser(), await h.createAuthUser(), await h.createAuthUser(), await h.createAuthUser(), await h.createAuthUser(),
  ];
  admin = await h.createAuthUser({ adminTier: "admin" });
  merchantId = randomUUID();
  rivalMerchantId = randomUUID();
  await h.db.query("insert into merchants (id, owner_id, business_name) values ($1, $2, 'Mine'), ($3, $4, 'Rival')", [merchantId, merchantOwner.id, rivalMerchantId, rivalOwner.id]);
  await h.db.query("insert into merchant_staff (merchant_id, user_id) values ($1, $2)", [merchantId, merchantStaffMember.id]);
});

async function order(status: string, forMerchant = merchantId): Promise<string> {
  const orderId = randomUUID();
  const id = randomUUID();
  await h.db.query("insert into orders (id, customer_id) values ($1, $2)", [orderId, customer.id]);
  await h.db.query("insert into merchant_orders (id, order_id, merchant_id, status) values ($1, $2, $3, $4)", [id, orderId, forMerchant, status]);
  return id;
}

const statusOf = async (id: string) => (await h.db.query<{ status: string }>("select status from merchant_orders where id = $1", [id])).rows[0].status;
const setStatus = (user: TestUser, id: string, status: string) => h.asUser(user.id, (tx) => tx.query("update merchant_orders set status = $2 where id = $1", [id, status]));

describe("merchant transitions", () => {
  it("allows exactly the legal moves, for the owner and for staff, and refuses every other pair", async () => {
    for (const from of STATUSES) {
      for (const to of STATUSES) {
        if (from === to) continue;
        const id = await order(from);
        const actor = (from.length + to.length) % 2 === 0 ? merchantOwner : merchantStaffMember;
        if (MERCHANT_LEGAL.has(`${from}>${to}`)) {
          await setStatus(actor, id, to);
          expect(await statusOf(id), `${from} -> ${to}`).toBe(to);
        } else {
          await expect(setStatus(actor, id, to), `${from} -> ${to}`).rejects.toThrow(/not allowed/);
          expect(await statusOf(id)).toBe(from);
        }
      }
    }
  });

  it("takes an order from new straight to processing in one move (the one-button accept)", async () => {
    const id = await order("new");
    await setStatus(merchantOwner, id, "processing");
    expect(await statusOf(id)).toBe("processing");
  });

  it("cannot reach picked_up, delivered or completed early, nor move backwards", async () => {
    for (const [from, to] of [["new", "ready_for_pickup"], ["new", "picked_up"], ["processing", "picked_up"], ["processing", "delivered"], ["processing", "new"], ["ready_for_pickup", "processing"], ["picked_up", "delivered"], ["delivered", "completed"]] as const) {
      const id = await order(from);
      await expect(setStatus(merchantOwner, id, to), `${from} -> ${to}`).rejects.toThrow(/not allowed/);
    }
  });
});

describe("other merchants' orders", () => {
  it("are invisible to a merchant that does not own them: the update touches nothing", async () => {
    const id = await order("new", rivalMerchantId);
    await setStatus(merchantOwner, id, "processing");
    await setStatus(merchantStaffMember, id, "rejected");
    expect(await statusOf(id)).toBe("new");
  });

  it("cannot be touched by someone who is not a member of any merchant or the customer either", async () => {
    const id = await order("new");
    await setStatus(stranger, id, "processing");
    expect(await statusOf(id)).toBe("new");
  });
});

describe("customer", () => {
  it("can cancel their own order until it is picked up, and do nothing else", async () => {
    for (const from of STATUSES) {
      const id = await order(from);
      if (CUSTOMER_FROM.has(from)) {
        await setStatus(customer, id, "cancelled");
        expect(await statusOf(id), from).toBe("cancelled");
      } else if (from !== "cancelled") {
        await expect(setStatus(customer, id, "cancelled"), from).rejects.toThrow(/not allowed/);
      }
    }
    const id = await order("new");
    await expect(setStatus(customer, id, "processing")).rejects.toThrow(/not allowed/);
    await expect(setStatus(customer, id, "delivered")).rejects.toThrow(/not allowed/);
  });
});

describe("trusted callers", () => {
  it("lets the service role (Edge Functions, the delivery callback, cron jobs) make any move", async () => {
    const id = await order("ready_for_pickup");
    await h.db.query("update merchant_orders set status = 'delivered' where id = $1", [id]);
    await h.db.query("update merchant_orders set status = 'completed' where id = $1", [id]);
    expect(await statusOf(id)).toBe("completed");
  });

  it("lets admin tier correct an order", async () => {
    const id = await order("delivered");
    await setStatus(admin, id, "processing");
    expect(await statusOf(id)).toBe("processing");
  });

  it("does not interfere with updates that leave the status alone", async () => {
    const id = await order("completed");
    await h.asUser(merchantOwner.id, (tx) => tx.query("update merchant_orders set status = status where id = $1", [id]));
    expect(await statusOf(id)).toBe("completed");
  });
});

describe("notification template", () => {
  it("adds the single accepted-and-preparing message", async () => {
    const { rows } = await h.db.query<{ body_template: string }>("select body_template from notification_templates where event_type = 'order_accepted_preparing'");
    expect(rows).toHaveLength(1);
    expect(rows[0].body_template).toContain("accepted and is being prepared");
  });
});
