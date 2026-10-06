import { describe, expect, it } from "vitest";
import { loadMerchantPickupContact, type MerchantContactDb } from "./merchant_contact.ts";

// A fake database that answers by the column list asked for, so each rollout stage can be simulated.
function fakeDb(answers: { withPrivate: { data: unknown; error: unknown }; legacy: { data: unknown; error: unknown } }) {
  const asked: string[] = [];
  const db: MerchantContactDb = {
    from: () => ({
      select: (columns: string) => {
        asked.push(columns);
        return { eq: () => ({ single: async () => (columns.includes("merchant_private") ? answers.withPrivate : answers.legacy) }) };
      },
    }),
  };
  return { db, asked };
}

const MISSING = { message: "Could not find a relationship between 'merchants' and 'merchant_private'" };

describe("loadMerchantPickupContact across the rollout", () => {
  it("BEFORE the expand migration: merchant_private does not exist, so it falls back to merchants.phone", async () => {
    const { db, asked } = fakeDb({ withPrivate: { data: null, error: MISSING }, legacy: { data: { business_name: "Habesha", phone: "+251911000001" }, error: null } });
    expect(await loadMerchantPickupContact(db, "m1")).toEqual({ data: { business_name: "Habesha", phone: "+251911000001" } });
    expect(asked).toEqual(["business_name, merchant_private ( phone )", "business_name, phone"]);
  });

  it("BETWEEN the migrations: reads merchant_private and never touches the old column", async () => {
    const { db, asked } = fakeDb({
      withPrivate: { data: { business_name: "Habesha", merchant_private: { phone: "+251911000002" } }, error: null },
      legacy: { data: { business_name: "Habesha", phone: "+251900000000" }, error: null },
    });
    expect((await loadMerchantPickupContact(db, "m1")).data?.phone).toBe("+251911000002");
    expect(asked).toHaveLength(1);
  });

  it("AFTER the contract migration: the old column is gone and only merchant_private answers", async () => {
    const { db } = fakeDb({
      withPrivate: { data: { business_name: "Habesha", merchant_private: [{ phone: "+251911000003" }] }, error: null },
      legacy: { data: null, error: { message: "column merchants.phone does not exist" } },
    });
    expect((await loadMerchantPickupContact(db, "m1")).data).toEqual({ business_name: "Habesha", phone: "+251911000003" });
  });

  it("gives a null phone, not a failure, for a merchant with no phone on file", async () => {
    const { db } = fakeDb({ withPrivate: { data: { business_name: "Habesha", merchant_private: null }, error: null }, legacy: { data: null, error: MISSING } });
    expect(await loadMerchantPickupContact(db, "m1")).toEqual({ data: { business_name: "Habesha", phone: null } });
  });

  it("returns no data when the merchant cannot be read at all", async () => {
    const { db } = fakeDb({ withPrivate: { data: null, error: MISSING }, legacy: { data: null, error: MISSING } });
    expect(await loadMerchantPickupContact(db, "gone")).toEqual({ data: null });
  });
});
