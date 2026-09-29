import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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
