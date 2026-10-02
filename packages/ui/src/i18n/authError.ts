import type { en } from "./locales/en";

type TFunction = (key: string, vars?: Record<string, string | number>) => string;

// Supabase Auth (GoTrue) errors are plain English and unpredictable in
// exact wording, so matching is substring-based (same convention as the
// backend's own sanitizeOrderError) rather than exact-equality. Anything
// unrecognized falls back to the generic translated message -- raw
// English auth error text must never reach the user in Amharic mode.
const MATCHERS: { test: (text: string) => boolean; key: keyof typeof en }[] = [
  { test: (text) => text.includes("Invalid login credentials"), key: "auth.invalidCredentials" },
  { test: (text) => text.includes("already registered"), key: "auth.alreadyRegistered" },
  { test: (text) => text.includes("Email not confirmed"), key: "auth.emailNotConfirmed" },
  { test: (text) => text.includes("New password should be different"), key: "auth.samePassword" },
  { test: (text) => text.includes("Password should be at least"), key: "auth.passwordTooWeak" },
];

export function translateAuthError(raw: string | null | undefined, t: TFunction): string {
  if (!raw) return t("toast.somethingWentWrong");
  const match = MATCHERS.find((m) => m.test(raw));
  return t(match ? match.key : "toast.somethingWentWrong");
}
