// The backend test project creates users, orders and fixtures. It must only ever do that on a throwaway LOCAL Supabase
// (`npx supabase start`, or the stack CI starts), never on the live project: tests used to run against live data, which
// is how 3,196 of 3,200 orders there came to be test orders (docs/development-guidelines.md, rule 1).
//
// Free of vitest imports on purpose: vitest.config.mts, tests/env.ts and a unit test all use it.

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

export function isLocalSupabaseUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return (url.protocol === "http:" || url.protocol === "https:") && LOCAL_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

/** Throws unless `raw` is a local Supabase URL. Returns it unchanged otherwise. */
export function assertLocalSupabaseUrl(raw: string): string {
  if (!isLocalSupabaseUrl(raw)) {
    let host = raw;
    try {
      host = new URL(raw).host;
    } catch {
      // keep the raw text for the message
    }
    throw new Error(
      `Refusing to run the backend tests against a non-local Supabase (${host}). ` +
        "Start a local one (`npx supabase start`) and point SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY at it " +
        "(`npx supabase status -o env`), or remove SUPABASE_URL (from tests/.env.test and your shell) to skip these tests. See tests/README.md.",
    );
  }
  return raw;
}
