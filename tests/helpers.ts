import { env, functionUrl } from "./env.ts";

interface CallOptions {
  method?: string;
  /** Omit to send the anon key as the bearer token — this is exactly what
   * a logged-out browser (or anyone who only has the public anon key) sends,
   * so it's the realistic "unauthenticated" case, not an artificial one. */
  token?: string;
  body?: unknown;
  headers?: Record<string, string>;
  query?: Record<string, string>;
}

export interface CallResult {
  status: number;
  headers: Headers;
  json: unknown;
}

export async function callFunction(name: string, opts: CallOptions = {}): Promise<CallResult> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    apikey: env.anonKey,
    Authorization: `Bearer ${opts.token ?? env.anonKey}`,
    ...opts.headers,
  };
  const url = new URL(functionUrl(name));
  if (opts.query) {
    for (const [key, value] of Object.entries(opts.query)) url.searchParams.set(key, value);
  }
  const res = await fetch(url, {
    method: opts.method ?? "POST",
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  let json: unknown = null;
  try {
    json = await res.clone().json();
  } catch {
    // Non-JSON body (e.g. an empty 200 from an OPTIONS preflight) — fine.
  }
  return { status: res.status, headers: res.headers, json };
}

export async function preflight(name: string, origin = "http://localhost:5173"): Promise<CallResult> {
  const res = await fetch(functionUrl(name), {
    method: "OPTIONS",
    headers: {
      Origin: origin,
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "authorization,content-type,apikey",
    },
  });
  return { status: res.status, headers: res.headers, json: null };
}
