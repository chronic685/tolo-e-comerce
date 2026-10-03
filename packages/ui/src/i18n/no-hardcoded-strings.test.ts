import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Group 5, item 8: "a check that no hard-coded user-facing strings remain
// in the pages you touched." A fully generic JSX-hardcoded-string linter
// is its own project -- this instead pins down the specific English
// literals each touched page used to render directly, now that they've
// been moved to en.ts/am.ts and are rendered through t(...) -- so if any
// of them is ever hardcoded back into one of these files (a copy-paste
// regression, a merge conflict resolved the wrong way), this fails.
// Scoped exactly to the pages this Group 5 PR touched, not the whole repo.
const ROOT = resolve(import.meta.dirname, "../../../..");

interface Check {
  file: string;
  mustImportTranslation: boolean;
  forbiddenLiterals: string[];
}

const CHECKS: Check[] = [
  {
    file: "frontend/src/components/Layout.tsx",
    mustImportTranslation: true,
    forbiddenLiterals: ['"Marketplace"', '"Shops"', '"My Orders"', "Sign in<", "Tolo is temporarily under maintenance"],
  },
  {
    file: "frontend/src/pages/Cart.tsx",
    mustImportTranslation: true,
    forbiddenLiterals: ["Your cart is empty<", "Proceed to checkout<", ">Remove<"],
  },
  {
    file: "frontend/src/pages/Checkout.tsx",
    mustImportTranslation: true,
    forbiddenLiterals: [">Checkout<", ">Deliver to<", ">Place order<", "Tip your rider"],
  },
  {
    file: "frontend/src/pages/OrderConfirmation.tsx",
    mustImportTranslation: true,
    forbiddenLiterals: ["Order placed!", ">Track order<", ">Continue shopping<"],
  },
  {
    file: "frontend/src/pages/OrderDetail.tsx",
    mustImportTranslation: true,
    forbiddenLiterals: [">Reorder<", "Report an issue (item never arrived", "Rate this product<"],
  },
  {
    file: "frontend/src/pages/Orders.tsx",
    mustImportTranslation: true,
    forbiddenLiterals: [">My Orders<", "No orders yet<"],
  },
  {
    file: "frontend/src/pages/Login.tsx",
    mustImportTranslation: true,
    forbiddenLiterals: [">Sign in<", "Forgot password?<"],
  },
  {
    file: "frontend/src/pages/Signup.tsx",
    mustImportTranslation: true,
    forbiddenLiterals: ["Create an account<", "Check your email<"],
  },
  {
    file: "frontend/src/pages/LegalPage.tsx",
    mustImportTranslation: true,
    forbiddenLiterals: ["Draft — pending legal review.", "Page not found<"],
  },
  {
    file: "frontend/src/lib/orderStatus.ts",
    mustImportTranslation: false,
    forbiddenLiterals: ['"Order placed"', '"Waiting for the merchant to confirm your order."'],
  },
  {
    file: "frontend/src/pages/Account.tsx",
    mustImportTranslation: true,
    forbiddenLiterals: ["Saved locations<", ">Favorites<", ">Support<"],
  },
  {
    file: "merchant-dashboard/src/components/Layout.tsx",
    mustImportTranslation: true,
    forbiddenLiterals: ['"Dashboard"', '"Products"', '"Reported Issues"', ">Sign out<"],
  },
  {
    file: "merchant-dashboard/src/pages/OrderDetail.tsx",
    mustImportTranslation: true,
    forbiddenLiterals: ["Can't fulfill this item<", "Confirm removed (refund if paid)<"],
  },
  {
    file: "merchant-dashboard/src/pages/Support.tsx",
    mustImportTranslation: true,
    forbiddenLiterals: ["Reported Issues<", "View attached photo<"],
  },
  {
    file: "admin-dashboard/src/components/Layout.tsx",
    mustImportTranslation: true,
    forbiddenLiterals: [">Tolo Admin<", "Change password<", ">Sign out<"],
  },
];

describe("no hard-coded user-facing strings in Group 5 touched pages", () => {
  for (const check of CHECKS) {
    it(`${check.file} renders through useTranslation(), not hard-coded literals`, () => {
      const source = readFileSync(resolve(ROOT, check.file), "utf-8");

      if (check.mustImportTranslation) {
        expect(source, `${check.file} should import useTranslation from @tolo/ui`).toMatch(/useTranslation/);
      }

      for (const literal of check.forbiddenLiterals) {
        expect(source.includes(literal), `${check.file} still contains the hard-coded literal: ${literal}`).toBe(false);
      }
    });
  }
});

// "Translating backend errors" (docs/i18n.md): a caught Supabase/Edge
// Function error must be routed through translateServerError(...) (or
// extractServerErrorText(...) first, for a functions.invoke() error) before
// it reaches toast.error(...)/setError(...) -- never passed through raw.
// Unlike the per-file literal list above, this scans every .ts/.tsx file in
// all three apps, so it catches a regression (or a brand-new call site)
// anywhere, not just in files this or an earlier pass happened to touch.
const APP_SRC_DIRS = ["frontend/src", "merchant-dashboard/src", "admin-dashboard/src"];

function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      out.push(...listSourceFiles(full));
    } else if ([".ts", ".tsx"].includes(extname(entry)) && !entry.endsWith(".test.ts") && !entry.endsWith(".test.tsx")) {
      out.push(full);
    }
  }
  return out;
}

// A raw identifier (optionally `.message`, optionally `await`-ed) passed
// directly as the sole argument -- e.g. toast.error(error.message),
// setError(err), setLoadError(await edgeFunctionError(error)). A call
// wrapped in translateServerError(...), or passed a string/template
// literal or a t("...") lookup, doesn't match this (there's a nested "("
// before the closing one, which the pattern below doesn't allow).
const RAW_ERROR_ARG = /\b(?:toast\.error|set\w*Error)\(\s*(?:await\s+)?([a-zA-Z_$][\w]*)(?:\.message)?\s*\)/;
// The same thing, but the raw value is interpolated into a template
// literal alongside translated/literal text (e.g. `Could not delete this
// account: ${await edgeFunctionError(error)}`), not passed as the sole arg
// -- always a .message access or an edgeFunctionError() call, so no
// name-based filtering is needed here the way RAW_ERROR_ARG needs below.
const RAW_ERROR_IN_TEMPLATE = /\b(?:toast\.error|set\w*Error)\(`[^`]*\$\{[^}]*(?:\.message|edgeFunctionError\()[^}]*\}[^`]*`\)/;

// RAW_ERROR_ARG's captured identifier is only actually a caught error --
// as opposed to a module-level constant like LISTING_ELIGIBILITY_ERROR, or
// an unrelated client-side validation string like a `usernameProblem()`
// result -- when its name says so: "error"/"err", or camelCase ending in
// "...Error" (uploadError, insertError, credError, ...). A SCREAMING_SNAKE
// constant also ends in "...ERROR" case-insensitively, so it's excluded by
// name shape first.
function looksLikeCaughtError(name: string): boolean {
  if (name === "null" || name === "undefined") return false;
  if (/^[A-Z][A-Z0-9_]*$/.test(name)) return false;
  return /^err$/i.test(name) || /error$/i.test(name);
}

describe("no raw backend error text bypassing translateServerError", () => {
  for (const dir of APP_SRC_DIRS) {
    it(`${dir}: every toast.error()/setXError() call with a caught error routes through translateServerError`, () => {
      const offenders: string[] = [];
      for (const file of listSourceFiles(resolve(ROOT, dir))) {
        const source = readFileSync(file, "utf-8");
        const relPath = relative(ROOT, file);
        source.split("\n").forEach((line, idx) => {
          if (line.includes("translateServerError")) return; // already safe
          const argMatch = RAW_ERROR_ARG.exec(line);
          const raw = (argMatch && looksLikeCaughtError(argMatch[1])) || RAW_ERROR_IN_TEMPLATE.test(line);
          if (raw) offenders.push(`${relPath}:${idx + 1}: ${line.trim()}`);
        });
      }
      expect(
        offenders,
        `Found call(s) that may show raw backend error text instead of a translateServerError(...) result:\n${offenders.join("\n")}`,
      ).toEqual([]);
    });
  }
});
