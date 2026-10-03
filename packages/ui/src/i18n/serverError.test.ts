import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { en } from "./locales/en";
import { extractServerErrorText, translateServerError, translateServerErrorAsync } from "./serverError";

// A minimal stand-in for useTranslation()'s t(key, vars) -- resolves
// straight against en.ts (interpolating {{vars}}) so these tests assert on
// the real English copy without needing an I18nProvider.
function t(key: string, vars?: Record<string, string | number>): string {
  const template = en[key as keyof typeof en] ?? key;
  if (!vars) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (match, name) => (name in vars ? String(vars[name]) : match));
}

describe("translateServerError", () => {
  it("maps a known exact backend error to its translated string", () => {
    expect(translateServerError("One or more items in your cart are no longer available in the requested quantity.", t)).toBe(
      en["errors.insufficientStock"],
    );
  });

  it("maps both checkout empty-cart variants to the same key", () => {
    expect(translateServerError("Cart is empty", t)).toBe(en["errors.cartEmpty"]);
    expect(translateServerError("Your cart is empty.", t)).toBe(en["errors.cartEmpty"]);
  });

  it("maps the PT429 rate-limit message to the generic rate-limit string, not its own raw English", () => {
    expect(translateServerError("Too many review submissions. Please try again shortly.", t)).toBe(en["errors.tooManyRequests"]);
  });

  it("maps a GoTrue auth error by substring, tolerant of exact SDK wording", () => {
    expect(translateServerError("Invalid login credentials", t)).toBe(en["errors.invalidLoginCredentials"]);
    expect(translateServerError("AuthApiError: User already registered", t)).toBe(en["errors.userAlreadyRegistered"]);
  });

  it("interpolates dynamic values from a pattern match", () => {
    expect(translateServerError("Your order subtotal (120 ETB) is below the minimum order value of 200 ETB.", t)).toBe(
      "Your order subtotal (120 ETB) is below the minimum order value of 200 ETB.",
    );
    expect(translateServerError("Please choose a delivery time at least 30 minutes from now.", t)).toBe(
      "Please choose a delivery time at least 30 minutes from now.",
    );
    expect(
      translateServerError(
        "New accounts are limited to 2 cash-on-delivery order(s) totaling up to 1500 ETB while your account is being verified. Please choose another payment method, or try again once your account is more established.",
        t,
      ),
    ).toBe(en["errors.codFraudLimit"].replace("{{maxOrders}}", "2").replace("{{maxAmount}}", "1500"));
    expect(translateServerError('Cannot pay an order whose payment is "refunded".', t)).toBe(
      en["errors.cannotPayPaymentStatus"].replace("{{status}}", "refunded"),
    );
  });

  it("falls back to the generic translated message and logs for anything unrecognized", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(translateServerError("relation \"foo\" does not exist", t)).toBe(en["toast.somethingWentWrong"]);
    expect(spy).toHaveBeenCalledWith("Untranslated backend error:", "relation \"foo\" does not exist");
    spy.mockRestore();
  });

  it("falls back to the generic translated message for null/empty input without logging", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(translateServerError(null, t)).toBe(en["toast.somethingWentWrong"]);
    expect(translateServerError("", t)).toBe(en["toast.somethingWentWrong"]);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("extractServerErrorText", () => {
  it("returns a plain string error as-is", async () => {
    expect(await extractServerErrorText("Sign-in failed.")).toBe("Sign-in failed.");
  });

  it("reads .message off a plain Error / PostgrestError / AuthError shape", async () => {
    expect(await extractServerErrorText(new Error("Invalid login credentials"))).toBe("Invalid login credentials");
    expect(await extractServerErrorText({ message: "duplicate key value" })).toBe("duplicate key value");
  });

  it("reads the real message out of a functions.invoke() error's .context response body", async () => {
    const response = new Response(JSON.stringify({ error: "Sign-in failed." }), { status: 401 });
    expect(await extractServerErrorText({ context: response, message: "Edge Function returned a non-2xx status code" })).toBe(
      "Sign-in failed.",
    );
  });

  it("prefers .message over .error in the context body (the rate-limit response shape)", async () => {
    const response = new Response(JSON.stringify({ error: "too_many_requests", message: "Too many requests. Please try again shortly." }), {
      status: 429,
    });
    expect(await extractServerErrorText({ context: response })).toBe("Too many requests. Please try again shortly.");
  });

  it("falls back to .message when the context body isn't JSON", async () => {
    const response = new Response("not json", { status: 500 });
    expect(await extractServerErrorText({ context: response, message: "fallback message" })).toBe("fallback message");
  });

  it("returns null for an unrecognized shape", async () => {
    expect(await extractServerErrorText(undefined)).toBeNull();
    expect(await extractServerErrorText(42)).toBeNull();
    expect(await extractServerErrorText({})).toBeNull();
  });
});

describe("translateServerErrorAsync", () => {
  beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  it("extracts and translates an edge-function error in one step", async () => {
    const response = new Response(JSON.stringify({ error: "This account is suspended and cannot place new orders." }), { status: 403 });
    expect(await translateServerErrorAsync({ context: response }, t)).toBe(en["errors.accountSuspended"]);
  });

  it("falls back to the generic message for an error with nothing recognizable", async () => {
    expect(await translateServerErrorAsync({}, t)).toBe(en["toast.somethingWentWrong"]);
  });
});
