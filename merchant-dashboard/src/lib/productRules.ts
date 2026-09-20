// Pure product-form business rules — no Supabase import here on purpose,
// so this stays importable from a plain unit test (or anywhere else) without
// pulling in a real client that needs live env vars to construct.

// Same rule enforced server-side (migration 0041) — checked here first so a
// caller (ProductForm.tsx, BulkUpload.tsx) gets an immediate, specific error
// instead of a generic trigger-rejection round trip. The database trigger
// remains the real guarantee this can't be bypassed by calling the API
// directly; this is a convenience layered on top of it.
export const LISTING_ELIGIBILITY_ERROR = "Products need either 2+ units in stock or a price of at least 1000 ETB to be listed for sale.";

export function isEligibleForListing(price: number, stock: number): boolean {
  return price >= 1000 || stock >= 2;
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export function parseAttributes(text: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  text
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .forEach((pair) => {
      const [k, v] = pair.split(":").map((s) => s.trim());
      if (k && v) attrs[k] = v;
    });
  return attrs;
}
