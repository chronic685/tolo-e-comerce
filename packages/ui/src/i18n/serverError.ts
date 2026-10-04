import type { en } from "./locales/en";

export type TFunction = (key: string, vars?: Record<string, string | number>) => string;

type ErrorKey = keyof typeof en;

interface Matcher {
  match(text: string): Record<string, string | number> | null;
  key: ErrorKey;
}

function exact(literal: string, key: ErrorKey): Matcher {
  return { match: (text) => (text === literal ? {} : null), key };
}

function includes(substr: string, key: ErrorKey): Matcher {
  return { match: (text) => (text.includes(substr) ? {} : null), key };
}

function pattern(re: RegExp, key: ErrorKey, vars: (m: RegExpMatchArray) => Record<string, string | number>): Matcher {
  return {
    match(text) {
      const m = text.match(re);
      return m ? vars(m) : null;
    },
    key,
  };
}

// Known backend error text -> errors.* translation key, in match order
// (first match wins). See docs/i18n.md "Translating backend errors". Every
// literal/pattern here is a message a Supabase Edge Function
// (create_order()'s sanitizeOrderError in checkout/index.ts, order-status,
// payment-initiate, tolo-app-login/tolo-merchant-login, etc.) or Supabase
// Auth (GoTrue) actually returns today -- add a new entry here, not a new
// per-call-site translation, whenever a new backend error needs mapping.
const MATCHERS: Matcher[] = [
  exact("One or more items in your cart are no longer available in the requested quantity.", "errors.insufficientStock"),
  exact("This account is suspended and cannot place new orders.", "errors.accountSuspended"),
  exact("Tolo is temporarily under maintenance. Please try again shortly.", "errors.maintenanceMode"),
  exact("Cart is empty", "errors.cartEmpty"),
  exact("Your cart is empty.", "errors.cartEmpty"),
  exact("One or more stores in your cart are not currently available. Please review your cart.", "errors.storeUnavailable"),
  exact(
    "One or more stores in your cart are currently closed. Please review your cart or try again during their opening hours.",
    "errors.storeClosed",
  ),
  exact("One or more items in your cart are no longer available. Please review your cart.", "errors.productUnavailable"),
  exact("You are not authorized to perform this action.", "errors.notAuthorized"),
  exact("Not authorized to confirm this payment", "errors.notAuthorized"),
  exact("This payment method is not currently available. Please choose another.", "errors.paymentMethodUnavailable"),
  exact("This payment method is not currently available.", "errors.paymentMethodUnavailable"),
  exact("Too many requests. Please try again shortly.", "errors.tooManyRequests"),
  // PT429 (PostgREST's convention for a rate-limit trigger, migration 0032):
  // same user-facing meaning as the generic rate-limit message above, just
  // worded for this specific action -- reuses the same translated key
  // rather than adding a near-duplicate string.
  exact("Too many review submissions. Please try again shortly.", "errors.tooManyRequests"),
  exact("Could not place your order. Please check your cart and try again.", "errors.genericCheckoutFailure"),
  exact("Your delivery address is too far from one of the stores in your cart for delivery.", "errors.tooFarFromStore"),
  exact("Scheduled orders are not currently available.", "errors.scheduledOrdersUnavailable"),
  exact("This order is already paid.", "errors.orderAlreadyPaid"),
  exact("This order was cancelled and can no longer be paid.", "errors.orderCancelledCannotPay"),
  exact("Order cancellation is currently disabled", "errors.orderCancellationDisabled"),
  exact("This order can no longer be cancelled because it is already with the driver.", "errors.orderWithDriver"),
  exact("This order's status just changed. Please refresh and try again.", "errors.orderStatusChanged"),
  exact("This account does not have Tolo staff access.", "errors.notToloStaff"),
  exact("This staff account has been suspended.", "errors.staffAccountSuspended"),
  includes("Invalid login credentials", "errors.invalidLoginCredentials"),
  includes("already registered", "errors.userAlreadyRegistered"),
  includes("Email not confirmed", "errors.emailNotConfirmed"),
  includes("New password should be different from the old password", "errors.samePasswordAsOld"),
  includes("Password should be at least", "auth.passwordTooWeak"),
  pattern(
    /^Your order subtotal \(([\d,.]+) ETB\) is below the minimum order value of ([\d,.]+) ETB\.$/,
    "errors.belowMinimumOrderValue",
    (m) => ({ subtotal: m[1], minimum: m[2] }),
  ),
  pattern(/^Please choose a delivery time at least (\d+) minutes? from now\.$/, "errors.deliveryTimeTooSoon", (m) => ({
    minutes: m[1],
  })),
  pattern(/^Please choose a delivery time within the next (\d+) days?\.$/, "errors.deliveryTimeTooFar", (m) => ({ days: m[1] })),
  pattern(
    /^New accounts are limited to (\d+) cash-on-delivery order\(s\) totaling up to ([\d,.]+) ETB/,
    "errors.codFraudLimit",
    (m) => ({ maxOrders: m[1], maxAmount: m[2] }),
  ),
  pattern(/^Cannot pay an order whose payment is "([a-z_]+)"\.?$/, "errors.cannotPayPaymentStatus", (m) => ({ status: m[1] })),
];

/**
 * Extracts the human-readable message from any error shape this repo's
 * client code encounters: a plain string, an Error/PostgrestError/AuthError
 * with `.message`, a DB rate-limit RPC error carrying `.code` ("PT429", see
 * migration 0032), or a `supabase.functions.invoke()` error -- whose real
 * JSON body lives behind `.context` (supabase-js replaces the message
 * itself with a generic "non-2xx status code" string; the response body
 * can carry both a machine-readable "error" and a human-readable
 * "message", e.g. the rate-limit response -- "message" wins when present).
 */
export async function extractServerErrorText(raw: unknown): Promise<string | null> {
  if (typeof raw === "string") return raw;
  if (!raw || typeof raw !== "object") return null;

  const context = (raw as { context?: Response }).context;
  if (context && typeof context.json === "function") {
    try {
      const body = await context.clone().json();
      if (typeof body?.message === "string") return body.message;
      if (typeof body?.error === "string") return body.error;
    } catch {
      // Non-JSON error body -- fall through to .message below.
    }
  }

  const message = (raw as { message?: unknown }).message;
  return typeof message === "string" ? message : null;
}

/**
 * Maps raw backend error text to its translated `errors.*` string via the
 * known-message table above. Anything unrecognized is logged to the
 * console (for debugging -- this is the only place that ever sees the raw
 * English) and replaced with the translated generic fallback: raw English
 * backend text must never reach the user directly, in either locale. See
 * docs/i18n.md "Translating backend errors".
 */
export function translateServerError(rawText: string | null | undefined, t: TFunction): string {
  if (!rawText) return t("toast.somethingWentWrong");
  const trimmed = rawText.trim();
  for (const matcher of MATCHERS) {
    const vars = matcher.match(trimmed);
    if (vars) return t(matcher.key, vars);
  }
  console.error("Untranslated backend error:", trimmed);
  return t("toast.somethingWentWrong");
}

/**
 * Convenience for the common case: an error straight from a Supabase call
 * (table/RPC error, Auth error, or `functions.invoke()` error) that needs
 * both extraction and translation in one step.
 */
export async function translateServerErrorAsync(raw: unknown, t: TFunction): Promise<string> {
  return translateServerError(await extractServerErrorText(raw), t);
}
