// Migration 0085 (audit-log noise + retention) run for real against in-process
// PGlite -- see tests/pglite/harness.ts. Never touches any Supabase project.
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./pglite/harness.ts";

// audit_logs (0012), system_settings (0025), notifications (0029), and the
// triggers 0026/0030 attach log_config_change() with.
const PRELUDE = /* sql */ `
alter table merchants add column is_test boolean not null default false;
create table audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid, action text not null, entity_type text not null, entity_id uuid, metadata jsonb,
  created_at timestamptz not null default now()
);
create table system_settings (key text primary key, value jsonb not null);
create table discount_rules (id uuid primary key default gen_random_uuid(), name text);
create table notifications (id uuid primary key default gen_random_uuid(), user_id uuid not null, is_read boolean not null default false, created_at timestamptz not null default now());
`;

let h: Harness;

beforeAll(async () => {
  h = await createHarness(["0085_retention_and_audit_noise.sql"], { prelude: PRELUDE });
  // Attached after the migration, as 0026/0030 attach it to the real tables.
  await h.db.exec(`
    create trigger system_settings_log_change after insert or update on system_settings for each row execute function log_config_change();
    create trigger discount_rules_log_change after insert or update on discount_rules for each row execute function log_config_change();
    create trigger merchants_log_change after insert or update on merchants for each row execute function log_config_change();
  `);
});

const auditRows = async (entityType: string) =>
  Number((await h.db.query<{ n: string }>("select count(*) n from audit_logs where entity_type = $1", [entityType])).rows[0].n);

describe("log_config_change()", () => {
  it("logs a config change made by a signed-in admin, with who", async () => {
    const admin = await h.createAuthUser({ adminTier: "admin" });
    await h.asUser(admin.id, (tx) => tx.query("insert into system_settings (key, value) values ('as_admin', '{}')"));
    const { rows } = await h.db.query<{ actor_id: string; action: string }>("select actor_id, action from audit_logs where entity_type = 'system_settings'");
    expect(rows).toEqual([{ actor_id: admin.id, action: "insert" }]);
  });

  it("does not log service-role writes (no actor) to the config tables", async () => {
    const before = await auditRows("system_settings");
    await h.asService((tx) => tx.query("insert into system_settings (key, value) values ('by_service', '{}')"));
    await h.asService((tx) => tx.query("update system_settings set value = '{\"x\":1}' where key = 'by_service'"));
    await h.asService((tx) => tx.query("insert into discount_rules (name) values ('by service')"));
    expect(await auditRows("system_settings")).toBe(before);
    expect(await auditRows("discount_rules")).toBe(0);
  });

  it("still logs a signed-in admin's change to a discount rule", async () => {
    const admin = await h.createAuthUser({ adminTier: "admin" });
    await h.asUser(admin.id, (tx) => tx.query("insert into discount_rules (name) values ('by admin')"));
    expect(await auditRows("discount_rules")).toBe(1);
  });

  it("does not log changes to an is_test merchant, but does log a real merchant's", async () => {
    const owner = await h.createAuthUser();
    await h.db.query("insert into merchants (id, owner_id, business_name, is_test) values ($1, $2, 'QA', true)", [randomUUID(), owner.id]);
    expect(await auditRows("merchants")).toBe(0);

    await h.db.query("insert into merchants (id, owner_id, business_name, is_test) values ($1, $2, 'Real', false)", [randomUUID(), owner.id]);
    expect(await auditRows("merchants")).toBe(1);
  });
});

describe("prune_old_operational_rows()", () => {
  const ago = (days: number) => `now() - interval '${days} days'`;
  const counts = async () => ({
    audit: Number((await h.db.query<{ n: string }>("select count(*) n from audit_logs where entity_type = 'prune_test'")).rows[0].n),
    notifications: Number((await h.db.query<{ n: string }>("select count(*) n from notifications where user_id = $1", [pruneUser])).rows[0].n),
  });
  const pruneUser = randomUUID();

  it("deletes old audit rows and old READ notifications only", async () => {
    await h.db.exec(`
      insert into audit_logs (action, entity_type, created_at) values ('update', 'prune_test', ${ago(400)}), ('update', 'prune_test', ${ago(181)}), ('update', 'prune_test', ${ago(179)}), ('update', 'prune_test', now());
    `);
    await h.db.query(
      `insert into notifications (user_id, is_read, created_at) values
        ($1, true, ${ago(91)}), ($1, true, ${ago(89)}), ($1, false, ${ago(400)}), ($1, false, now())`,
      [pruneUser],
    );

    const { rows } = await h.asService((tx) =>
      tx.query<{ cron_runs_deleted: number; audit_logs_deleted: number; notifications_deleted: number }>("select * from prune_old_operational_rows()"),
    );
    expect(rows[0]).toMatchObject({ audit_logs_deleted: 2, notifications_deleted: 1, cron_runs_deleted: 0 });
    // Kept: the 179-day and fresh audit rows; the 89-day read one and both unread ones (even a year old).
    expect(await counts()).toEqual({ audit: 2, notifications: 3 });
  });

  it("is not callable by users or anon", async () => {
    const user = await h.createAuthUser();
    await expect(h.asUser(user.id, (tx) => tx.query("select * from prune_old_operational_rows()"))).rejects.toThrow(/permission denied/);
    await expect(h.asAnon((tx) => tx.query("select * from prune_old_operational_rows()"))).rejects.toThrow(/permission denied/);
  });
});
