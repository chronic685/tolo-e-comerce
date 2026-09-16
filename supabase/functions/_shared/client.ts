import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Service-role client: bypasses RLS. Only use inside Edge Functions after
// the caller's identity/authorization has been established explicitly.
export function serviceClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

// User-scoped client: runs queries as the calling user, so RLS still applies.
export function userClient(req: Request) {
  const authHeader = req.headers.get("Authorization") ?? "";
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
}
