// Migration 0078 (payment gateway settings + sms_outbox) run for real against
// in-process PGlite -- see tests/pglite/harness.ts. Never touches any Supabase project.
import { describe, expect, it } from "vitest";
import { createHarness } from "./pglite/harness.ts";

// Tables/functions the migration references that the shared harness stubs
// don't model: system_settings (0012) and has_admin_page (exactly 0051's body).
const prelude = (paymentMethods: string) => /* sql */ `
create table system_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references profiles(id)
);
create function has_admin_page(p_keys text[]) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles
    where id = auth.uid()
      and account_status = 'active'
      and (admin_tier is not null or (role::text like 'tolo\\_%' and permissions ?| p_keys))
  );
$$;
insert into system_settings (key, value) values ('payment_methods', '${paymentMethods}'::jsonb);
`;

const MIGRATION = "0078_payment_gateways_and_sms_outbox.sql";

async function paymentMethods(h: Awaited<ReturnType<typeof createHarness>>) {
  const { rows } = await h.db.query<{ value: Record<string, boolean> }>("select value from system_settings where key = 'payment_methods'");
  return rows[0].value;
}

describe("payment_methods setting", () => {
  it("adds chapa and telebirr switched OFF, leaving the existing methods exactly as they were", async () => {
    const h = await createHarness([MIGRATION], {
      prelude: prelude('{"cash_on_delivery": true, "bank_transfer": true, "mobile_money": false}'),
    });
    expect(await paymentMethods(h)).toEqual({
      cash_on_delivery: true,
      bank_transfer: true,
      mobile_money: false,
      chapa: false,
      telebirr: false,
    });
  });

  it("never overrides a value someone already saved", async () => {
    const h = await createHarness([MIGRATION], {
      prelude: prelude('{"cash_on_delivery": true, "chapa": true, "telebirr": true}'),
    });
    expect(await paymentMethods(h)).toMatchObject({ chapa: true, telebirr: true });
  });
});

describe("sms_outbox", () => {
  async function setup() {
    const h = await createHarness([MIGRATION], { prelude: prelude('{"cash_on_delivery": true}') });
    const customer = await h.createAuthUser();
    const admin = await h.createAuthUser({ adminTier: "admin" });
    const settingsStaff = await h.createAuthUser({ role: "tolo_support" });
    await h.db.query("update profiles set permissions = '[\"settings\"]'::jsonb where id = $1", [settingsStaff.id]);
    const ordersStaff = await h.createAuthUser({ role: "tolo_ops" });
    await h.db.query("update profiles set permissions = '[\"orders\"]'::jsonb where id = $1", [ordersStaff.id]);

    await h.asService((tx) =>
      tx.query(
        "insert into sms_outbox (user_id, phone, body, provider, status, event_type) values ($1, '+251911223344', 'Order ready', 'mock', 'mock', 'order_ready_for_pickup')",
        [customer.id],
      ),
    );
    return { h, customer, admin, settingsStaff, ordersStaff };
  }

  it("lets Tolo admins and staff with the Settings page read the log", async () => {
    const { h, admin, settingsStaff } = await setup();
    for (const user of [admin, settingsStaff]) {
      const { rows } = await h.asUser(user.id, (tx) => tx.query("select * from sms_outbox"));
      expect(rows).toHaveLength(1);
    }
  });

  it("hides the log from customers, anonymous visitors, and staff without a relevant page", async () => {
    const { h, customer, ordersStaff } = await setup();
    for (const user of [customer, ordersStaff]) {
      const { rows } = await h.asUser(user.id, (tx) => tx.query("select * from sms_outbox"));
      expect(rows).toHaveLength(0);
    }
    const { rows } = await h.asAnon((tx) => tx.query("select * from sms_outbox"));
    expect(rows).toHaveLength(0);
  });

  it("lets the service role (Edge Functions) write", async () => {
    const { h } = await setup();
    await h.asService((tx) => tx.query("insert into sms_outbox (phone, body, provider, status) values ('+251922334455', 'x', 'africastalking', 'sent')"));
    const { rows } = await h.db.query("select * from sms_outbox");
    expect(rows).toHaveLength(2);
  });

  it("does not let even an admin forge, edit or erase log rows", async () => {
    const { h, admin } = await setup();
    await expect(
      h.asUser(admin.id, (tx) => tx.query("insert into sms_outbox (phone, body, provider, status) values ('+251900000000', 'forged', 'mock', 'sent')")),
    ).rejects.toThrow(/row-level security/);

    await h.asUser(admin.id, (tx) => tx.query("update sms_outbox set body = 'tampered'"));
    await h.asUser(admin.id, (tx) => tx.query("delete from sms_outbox"));
    const { rows } = await h.db.query<{ body: string }>("select body from sms_outbox");
    expect(rows).toEqual([{ body: "Order ready" }]);
  });

  it("only accepts the three known statuses", async () => {
    const { h } = await setup();
    await expect(
      h.asService((tx) => tx.query("insert into sms_outbox (phone, body, provider, status) values ('+251911223344', 'x', 'mock', 'delivered')")),
    ).rejects.toThrow(/status/);
  });

  it("keeps the log row, minus the link to the person, when their account is deleted", async () => {
    const { h, customer } = await setup();
    await h.db.query("delete from auth.users where id = $1", [customer.id]);
    const { rows } = await h.db.query<{ user_id: string | null; body: string }>("select user_id, body from sms_outbox");
    expect(rows).toEqual([{ user_id: null, body: "Order ready" }]);
  });
});
