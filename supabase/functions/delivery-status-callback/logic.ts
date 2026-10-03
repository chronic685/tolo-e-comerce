// Decision logic for the Tolo Delivery app's delivery status callback
// (contract: docs/integration/delivery-handoff.md), free of Deno/network/
// database code so it runs under plain Vitest -- same split as
// merchant-application-status/logic.ts.
import { checkBearerKey } from "../_shared/inbound_auth.ts";

export const CALLBACK_STATUSES = ["accepted", "picked_up", "delivered", "failed"] as const;
export type CallbackStatus = (typeof CALLBACK_STATUSES)[number];

export interface StatusUpdate {
  jobId: string;
  status: CallbackStatus;
  driverRef: string | null;
  etaMinutes: number | null;
  failureReason: string | null;
}

export interface CallbackDeps {
  /** apply_delivery_job_update(): throws an Error whose message is one of its error codes. */
  apply(update: StatusUpdate): Promise<{ outcome: "applied" | "unchanged"; merchantOrderId: string }>;
  /** Tells the customer, for the statuses that warrant it. Called only after a change was applied. */
  afterApplied(update: StatusUpdate, merchantOrderId: string): Promise<void>;
}

export interface CallbackRequest {
  authorization: string | null;
  // TOLO_BACKEND_INBOUND_KEY; undefined when the secret isn't set.
  expectedKey: string | undefined;
  body: unknown;
}

export type CallbackResult = { status: number; body: Record<string, unknown> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SQL_ERRORS: Record<string, { status: number; error: string }> = {
  job_not_found: { status: 404, error: "Unknown job_id." },
  invalid_transition: { status: 409, error: "That status can't follow the job's current status." },
  driver_ref_required: { status: 422, error: "driver_ref is required once a driver is assigned." },
  invalid_status: { status: 400, error: "Invalid status." },
};

function parse(body: unknown): StatusUpdate | string {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  if (typeof b.job_id !== "string" || !UUID.test(b.job_id)) return "job_id must be the job_id from the handoff.";
  if (typeof b.status !== "string" || !(CALLBACK_STATUSES as readonly string[]).includes(b.status)) {
    return `status must be one of: ${CALLBACK_STATUSES.join(", ")}.`;
  }
  if (b.driver_ref !== undefined && b.driver_ref !== null && (typeof b.driver_ref !== "string" || b.driver_ref.length > 100)) {
    return "driver_ref must be a string of at most 100 characters.";
  }
  if (b.eta_minutes !== undefined && b.eta_minutes !== null) {
    if (typeof b.eta_minutes !== "number" || !Number.isInteger(b.eta_minutes) || b.eta_minutes < 0 || b.eta_minutes > 1440) {
      return "eta_minutes must be a whole number of minutes from now, 0 to 1440.";
    }
  }
  if (b.failure_reason !== undefined && b.failure_reason !== null && (typeof b.failure_reason !== "string" || b.failure_reason.length > 500)) {
    return "failure_reason must be a string of at most 500 characters.";
  }
  return {
    jobId: b.job_id,
    status: b.status as CallbackStatus,
    driverRef: typeof b.driver_ref === "string" && b.driver_ref.trim() ? b.driver_ref.trim() : null,
    etaMinutes: typeof b.eta_minutes === "number" ? b.eta_minutes : null,
    failureReason: typeof b.failure_reason === "string" && b.failure_reason.trim() ? b.failure_reason.trim() : null,
  };
}

export async function handleCallback(req: CallbackRequest, deps: CallbackDeps): Promise<CallbackResult> {
  const auth = checkBearerKey(req.authorization, req.expectedKey);
  if (auth === "not_configured") return { status: 503, body: { error: "Not configured." } };
  if (auth === "unauthorized") return { status: 401, body: { error: "Unauthorized." } };

  const update = parse(req.body);
  if (typeof update === "string") return { status: 400, body: { error: update } };

  let result: Awaited<ReturnType<CallbackDeps["apply"]>>;
  try {
    result = await deps.apply(update);
  } catch (err) {
    const known = SQL_ERRORS[err instanceof Error ? err.message : ""];
    if (known) return { status: known.status, body: { error: known.error } };
    throw err;
  }

  if (result.outcome === "applied") await deps.afterApplied(update, result.merchantOrderId);
  return { status: 200, body: { ok: true, job_id: update.jobId, status: update.status, applied: result.outcome === "applied" } };
}
