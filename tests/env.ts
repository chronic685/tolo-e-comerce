// Central environment access for the test suite. Fails loudly and
// immediately if a required variable is missing — per the project's own
// Phase 0 rule, tests must never silently fall back to a fake value.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable ${name}. Copy tests/.env.test.example to tests/.env.test (or set it in CI secrets) before running the test suite.`,
    );
  }
  return value;
}

// CI must only ever run against the throwaway local Supabase the workflow
// starts (see .github/workflows/ci.yml), so refuse any other URL there --
// even if someone adds live-project secrets back to the workflow later.
function supabaseUrl(): string {
  const url = required("SUPABASE_URL");
  if (process.env.CI === "true" && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(url)) {
    throw new Error(`Refusing to run tests in CI against a non-local Supabase (${url}).`);
  }
  return url;
}

export const env = {
  supabaseUrl: supabaseUrl(),
  anonKey: required("SUPABASE_ANON_KEY"),
  serviceRoleKey: required("SUPABASE_SERVICE_ROLE_KEY"),
  qaMerchantAEmail: required("QA_MERCHANT_A_EMAIL"),
  qaMerchantAPassword: required("QA_MERCHANT_A_PASSWORD"),
  qaMerchantBEmail: required("QA_MERCHANT_B_EMAIL"),
  qaMerchantBPassword: required("QA_MERCHANT_B_PASSWORD"),
  qaCustomerEmail: required("QA_CUSTOMER_EMAIL"),
  qaCustomerPassword: required("QA_CUSTOMER_PASSWORD"),
  qaStaffEmail: required("QA_STAFF_EMAIL"),
  qaStaffPassword: required("QA_STAFF_PASSWORD"),
};

export function functionUrl(name: string): string {
  return `${env.supabaseUrl}/functions/v1/${name}`;
}

// Anon-key client — never trusted with a session; used only to sign in and
// obtain a real user JWT, exactly like the production frontend apps do.
export function anonClient(): SupabaseClient {
  return createClient(env.supabaseUrl, env.anonKey);
}

// Service-role client — bypasses RLS. Used only for fixture setup/teardown
// and for reading calculation RPCs directly, never to exercise the thing
// under test (that must always go through the real auth/RLS boundary).
export function serviceClient(): SupabaseClient {
  return createClient(env.supabaseUrl, env.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function signIn(email: string, password: string): Promise<string> {
  const client = anonClient();
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.session) {
    throw new Error(`Could not sign in as ${email}: ${error?.message ?? "no session returned"}`);
  }
  return data.session.access_token;
}
