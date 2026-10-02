import { describe, expect, it } from "vitest";
import { en } from "./locales/en";
import { translateAuthError } from "./authError";

function t(key: string, vars?: Record<string, string | number>): string {
  const template = en[key as keyof typeof en] ?? key;
  if (!vars) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (match, name) => (name in vars ? String(vars[name]) : match));
}

describe("translateAuthError", () => {
  it("maps known GoTrue messages to their translated string", () => {
    expect(translateAuthError("Invalid login credentials", t)).toBe(en["auth.invalidCredentials"]);
    expect(translateAuthError("AuthApiError: User already registered", t)).toBe(en["auth.alreadyRegistered"]);
    expect(translateAuthError("Email not confirmed", t)).toBe(en["auth.emailNotConfirmed"]);
    expect(translateAuthError("New password should be different from the old password.", t)).toBe(en["auth.samePassword"]);
    expect(translateAuthError("Password should be at least 6 characters.", t)).toBe(en["auth.passwordTooWeak"]);
  });

  it("falls back to the generic translated message for anything unrecognized or empty", () => {
    expect(translateAuthError("some unexpected GoTrue message", t)).toBe(en["toast.somethingWentWrong"]);
    expect(translateAuthError(null, t)).toBe(en["toast.somethingWentWrong"]);
    expect(translateAuthError("", t)).toBe(en["toast.somethingWentWrong"]);
  });
});
