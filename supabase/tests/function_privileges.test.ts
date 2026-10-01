// Local mirror of tests/unit/function-privileges.test.ts for the Tolo-app
// migrations (0072-0076): that test runs against a real Supabase, so it
// only runs in CI; this one runs the same check -- "no public function is
// executable by anon/authenticated unless deliberately allowed" -- against
// the real migration SQL in PGlite, with Supabase's default function
// grants modelled (pglite/harness.ts).
import { describe, expect, it } from "vitest";
import { createHarness } from "./pglite/harness.ts";

// The only functions these migrations intend to be client-callable, plus
// the harness's own stand-ins for pre-existing repo functions (already on
// the repo test's allow-list).
const ALLOWED = new Map<string, { anon: boolean; authenticated: boolean }>([
  ["submit_merchant_application", { anon: false, authenticated: true }],
  ["is_tolo_admin", { anon: true, authenticated: true }],
  ["set_updated_at", { anon: true, authenticated: true }],
]);

describe("function privileges for the Tolo-app migrations", () => {
  it("no function is executable by anon/authenticated except as intended", async () => {
    const h = await createHarness([
      "0072_tolo_phone_links.sql",
      "0073_merchant_applications.sql",
      "0074_merchant_application_licenses_storage.sql",
      "0075_merchant_application_approval.sql",
      "0076_tolo_merchant_login.sql",
    ]);
    const { rows } = await h.db.query<{ proname: string; anon_exec: boolean; authenticated_exec: boolean }>(`
      select p.proname,
             has_function_privilege('anon', p.oid, 'execute') as anon_exec,
             has_function_privilege('authenticated', p.oid, 'execute') as authenticated_exec
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
      order by p.proname
    `);
    expect(rows.length).toBeGreaterThan(10); // sanity: the migrations' functions are there

    const unexpected = rows.filter((r) => {
      const allowed = ALLOWED.get(r.proname) ?? { anon: false, authenticated: false };
      return (r.anon_exec && !allowed.anon) || (r.authenticated_exec && !allowed.authenticated);
    });
    expect(unexpected).toEqual([]);
  });
});
