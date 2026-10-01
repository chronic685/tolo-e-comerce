// CI only: a stand-in for the Tolo backend's verify-code endpoint
// (contract: docs/integration/tolo-app.md), so the tolo-app-login and
// tolo-merchant-login Edge Functions can be called for real under CI's
// Deno runtime. Started by .github/workflows/ci.yml before
// `supabase functions serve`; the functions reach it through
// TOLO_BACKEND_URL in tests/ci/functions.env.
//
// Codes are self-describing so tests need no issuing endpoint:
//   valid.<phone>.<nonce>   -> valid once for <phone>, then "already_used"
//   expired.<anything>      -> "expired_code"
//   anything else           -> "invalid_code"
// Every request must carry the shared key, exactly like the real backend.
import { createServer } from "node:http";

const PORT = Number(process.env.TOLO_STUB_PORT ?? 54399);
const SHARED_KEY = process.env.TOLO_BACKEND_SHARED_KEY;
if (!SHARED_KEY) {
  console.error("TOLO_BACKEND_SHARED_KEY is required");
  process.exit(1);
}

const used = new Set();

function send(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

createServer((req, res) => {
  if (req.method === "GET" && req.url === "/health") return send(res, 200, { ok: true });
  if (req.method !== "POST" || req.url !== "/integrations/tolo-marketplace/verify-code") return send(res, 404, { error: "not found" });
  if (req.headers.authorization !== `Bearer ${SHARED_KEY}`) {
    console.log("verify-code: rejected (bad shared key)");
    return send(res, 401, { error: "unauthorized" });
  }

  let raw = "";
  req.on("data", (chunk) => (raw += chunk));
  req.on("end", () => {
    let code;
    try {
      code = JSON.parse(raw).code;
    } catch {
      return send(res, 400, { error: "bad json" });
    }
    const [kind, phone] = String(code).split(".");
    if (kind === "expired") return send(res, 200, { valid: false, reason: "expired_code" });
    if (kind !== "valid" || !phone) return send(res, 200, { valid: false, reason: "invalid_code" });
    if (used.has(code)) return send(res, 200, { valid: false, reason: "already_used" });
    used.add(code);
    console.log("verify-code: valid");
    return send(res, 200, { valid: true, phone, name: "CI Tolo User" });
  });
}).listen(PORT, "0.0.0.0", () => console.log(`Tolo backend stub listening on :${PORT}`));
