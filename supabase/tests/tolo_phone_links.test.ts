// The phone-hijack fix (migration 0072), proven against the real login
// logic (tolo-app-login/logic.ts) and the real SQL, in in-process PGlite.
// Only the Tolo backend and session minting are mocked (pglite/appLogin.ts).
import { beforeAll, describe, expect, it } from "vitest";
import { handleAppLogin } from "../functions/tolo-app-login/logic.ts";
import { createHarness, nextPhone, type Harness } from "./pglite/harness.ts";
import { mockToloBackend, pgliteAppLoginDeps, type MockToloBackend } from "./pglite/appLogin.ts";

let h: Harness;
let tolo: MockToloBackend;

beforeAll(async () => {
  h = await createHarness(["0072_tolo_phone_links.sql"]);
  tolo = mockToloBackend();
});

async function toloLogin(phone: string): Promise<string> {
  const result = await handleAppLogin(tolo.issueCode(phone), pgliteAppLoginDeps(h, tolo));
  if (!result.ok) throw new Error(`login failed: ${result.error}`);
  return result.userId;
}

describe("phone hijack via a self-edited profile phone", () => {
  it("editing your own profile phone to a victim's number does not capture the victim's Tolo login", async () => {
    const victimPhone = nextPhone();
    const victimId = await toloLogin(victimPhone);

    // The attacker is an ordinary signed-in customer. Their own profile
    // phone is theirs to edit -- and they set it to the victim's number.
    const attacker = await h.createAuthUser();
    const edit = await h.asUser(attacker.id, (tx) =>
      tx.query("update profiles set phone = $1, phone_verified = true where id = $2", [victimPhone, attacker.id]),
    );
    expect(edit.affectedRows).toBe(1); // the edit itself is allowed

    // The lookup login matching uses sees exactly one account for that
    // phone -- the victim's -- not the attacker's edited profile too.
    const { rows } = await h.asService((tx) =>
      tx.query<{ user_id: string }>("select user_id from tolo_account_for_phone($1)", [victimPhone]),
    );
    expect(rows).toEqual([{ user_id: victimId }]);

    // The victim signs in from the Tolo app again: still their own account.
    expect(await toloLogin(victimPhone)).toBe(victimId);
    expect(await toloLogin(victimPhone)).not.toBe(attacker.id);
  });

  it("pre-setting a profile phone before the real owner's FIRST Tolo login doesn't capture it either", async () => {
    // The old matching (by profiles.phone) handed this login straight to
    // the attacker, since no account was linked yet.
    const phone = nextPhone();
    const attacker = await h.createAuthUser();
    await h.asUser(attacker.id, (tx) => tx.query("update profiles set phone = $1 where id = $2", [phone, attacker.id]));

    const ownerId = await toloLogin(phone);
    expect(ownerId).not.toBe(attacker.id);
    const { rows } = await h.db.query<{ user_id: string }>("select user_id from tolo_phone_links where phone = $1", [phone]);
    expect(rows).toEqual([{ user_id: ownerId }]);
  });

  it("a user can't write the link table: no insert, update, or delete -- even for their own row", async () => {
    const victimPhone = nextPhone();
    const victimId = await toloLogin(victimPhone);
    const attacker = await h.createAuthUser();
    const ownPhone = nextPhone();
    const attackerTolo = await toloLogin(ownPhone);

    await expect(
      h.asUser(attacker.id, (tx) => tx.query("insert into tolo_phone_links (user_id, phone) values ($1, $2)", [attacker.id, nextPhone()])),
    ).rejects.toThrow(/permission denied/);
    await expect(
      h.asUser(attackerTolo, (tx) => tx.query("update tolo_phone_links set phone = $1 where user_id = $2", [victimPhone, attackerTolo])),
    ).rejects.toThrow(/permission denied/);
    await expect(
      h.asUser(victimId, (tx) => tx.query("delete from tolo_phone_links where user_id = $1", [victimId])),
    ).rejects.toThrow(/permission denied/);
  });

  it("users can't call the linking functions themselves", async () => {
    const attacker = await h.createAuthUser();
    for (const sql of [
      "select link_tolo_phone($1, '+251911111111')",
      "select * from tolo_account_for_phone('+251911111111')",
      "select record_tolo_login($1)",
    ]) {
      await expect(h.asUser(attacker.id, (tx) => tx.query(sql, sql.includes("$1") ? [attacker.id] : []))).rejects.toThrow(
        /permission denied/,
      );
    }
  });

  it("a user sees only their own link", async () => {
    const a = await toloLogin(nextPhone());
    await toloLogin(nextPhone());
    const { rows } = await h.asUser(a, (tx) => tx.query<{ user_id: string }>("select user_id from tolo_phone_links"));
    expect(rows).toEqual([{ user_id: a }]);
  });
});

describe("linking behaviour", () => {
  it("first Tolo login creates and links an account; later logins reuse it", async () => {
    const phone = nextPhone();
    const first = await toloLogin(phone);
    expect(await toloLogin(phone)).toBe(first);
    const { rows } = await h.db.query("select 1 from tolo_phone_links where phone = $1", [phone]);
    expect(rows).toHaveLength(1);
  });

  it("a staff/admin account linked to a phone is refused, with the generic failure", async () => {
    const phone = nextPhone();
    const userId = await toloLogin(phone);
    await h.db.query("update profiles set admin_tier = 'admin' where id = $1", [userId]);
    expect(await handleAppLogin(tolo.issueCode(phone), pgliteAppLoginDeps(h, tolo))).toEqual({
      ok: false,
      status: 401,
      error: "Sign-in failed.",
    });
  });

  it("losing a concurrent first-login race discards the losing account instead of double-linking", async () => {
    const phone = nextPhone();
    const deps = pgliteAppLoginDeps(h, tolo);
    await deps.createCustomer(phone, "Winner");
    await expect(deps.createCustomer(phone, "Loser")).rejects.toThrow("Could not create customer account.");
    const { rows } = await h.db.query<{ full_name: string }>(
      "select p.full_name from profiles p join tolo_phone_links l on l.user_id = p.id where l.phone = $1",
      [phone],
    );
    expect(rows).toEqual([{ full_name: "Winner" }]);
    const losers = await h.db.query("select 1 from profiles where full_name = 'Loser'");
    expect(losers.rows).toHaveLength(0);
  });
});
