// Bearer-key check shared by the endpoints the Tolo backend (or this
// project's own functions) call with a secret key. Free of Deno code so the
// logic tests can import it under plain Vitest.

// Length-independent comparison, so response timing doesn't reveal how
// much of a guessed key was right.
export function constantTimeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  }
  return diff === 0;
}

export type KeyCheck = "ok" | "not_configured" | "unauthorized";

// `expectedKey` is the secret as configured (undefined/empty when unset: an
// unset key refuses every request rather than accepting an empty bearer).
export function checkBearerKey(authorization: string | null, expectedKey: string | undefined): KeyCheck {
  if (!expectedKey) return "not_configured";
  if (!authorization || !constantTimeEqual(authorization, `Bearer ${expectedKey}`)) return "unauthorized";
  return "ok";
}
