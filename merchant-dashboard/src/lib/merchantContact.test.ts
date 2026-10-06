import { beforeEach, describe, expect, it, vi } from "vitest";

const upsert = vi.hoisted(() => vi.fn());
const update = vi.hoisted(() => vi.fn());
const eq = vi.hoisted(() => vi.fn());

vi.mock("./supabase", () => ({
  supabase: {
    from: (table: string) =>
      table === "merchant_private" ? { upsert } : { update: (fields: unknown) => (update(fields), { eq }) },
  },
}));

import { isMerchantPrivateMissing, saveMerchantContact } from "./merchantContact";

const fields = { phone: "+251911000001", email: "a@b.test", owner_full_name: "Abebe", owner_phone: null, owner_email: "a@b.test" };

beforeEach(() => {
  upsert.mockReset();
  update.mockReset();
  eq.mockReset();
});

describe("saveMerchantContact across the rollout", () => {
  it("writes merchant_private when it exists (after the expand migration)", async () => {
    upsert.mockResolvedValue({ error: null });
    expect(await saveMerchantContact("m1", fields)).toEqual({ error: null });
    expect(upsert).toHaveBeenCalledWith({ merchant_id: "m1", ...fields });
    expect(update).not.toHaveBeenCalled();
  });

  it("falls back to the old columns on merchants when merchant_private does not exist yet (before the expand migration)", async () => {
    upsert.mockResolvedValue({ error: { code: "PGRST205", message: "Could not find the table 'public.merchant_private' in the schema cache" } });
    eq.mockResolvedValue({ error: null });
    expect(await saveMerchantContact("m1", fields)).toEqual({ error: null });
    expect(update).toHaveBeenCalledWith(fields);
    expect(eq).toHaveBeenCalledWith("id", "m1");
  });

  it("reports a real error instead of masking it with the fallback", async () => {
    upsert.mockResolvedValue({ error: { code: "42501", message: "new row violates row-level security policy for table \"merchant_private\"" } });
    const result = await saveMerchantContact("m1", fields);
    expect(result.error?.message).toMatch(/row-level security/);
    expect(update).not.toHaveBeenCalled();
  });
});

describe("isMerchantPrivateMissing", () => {
  it("recognises a missing table or relationship, and nothing else", () => {
    expect(isMerchantPrivateMissing({ code: "PGRST205", message: "Could not find the table 'public.merchant_private' in the schema cache" })).toBe(true);
    expect(isMerchantPrivateMissing({ code: "42P01", message: 'relation "merchant_private" does not exist' })).toBe(true);
    expect(isMerchantPrivateMissing({ code: "23505", message: "duplicate key value" })).toBe(false);
    expect(isMerchantPrivateMissing(null)).toBe(false);
  });
});
