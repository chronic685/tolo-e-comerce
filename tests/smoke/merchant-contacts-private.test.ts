import { beforeAll, describe, expect, inject, it } from "vitest";
import { anonClient, env, signIn } from "../env.ts";
import { createClient } from "@supabase/supabase-js";

// Migrations 0099 (expand) and 0100 (contract): a merchant's phone, email, owner name/phone/email and registration number moved off the publicly
// readable merchants row into merchant_private. Until then the public anon key could read all of them for every
// active merchant. This replicates what a visitor (anon) and a signed-in customer can do, against the real API.
describe("merchant contact details are not public", () => {
  const anon = anonClient();
  let merchantAId: string;

  beforeAll(() => {
    merchantAId = inject("qaFixtures").merchantAId;
  });

  const CONTACT_COLUMNS = ["phone", "email", "owner_full_name", "owner_phone", "owner_email", "business_registration_number"];

  it("an anonymous visitor cannot select any contact column from merchants", async () => {
    for (const column of CONTACT_COLUMNS) {
      const { error } = await anon.from("merchants").select(column).limit(1);
      expect(error, `${column} must not exist on merchants`).not.toBeNull();
    }
  });

  it("an anonymous visitor reading whole merchant rows gets no contact fields", async () => {
    const { data, error } = await anon.from("merchants").select("*").eq("status", "active").limit(20);
    expect(error).toBeNull();
    for (const row of data ?? []) {
      for (const column of CONTACT_COLUMNS) expect(Object.keys(row)).not.toContain(column);
    }
  });

  it("the storefront reads still work for an anonymous visitor (status, is_test and the rating columns)", async () => {
    const { error } = await anon
      .from("stores")
      .select("id, name, slug, merchants!inner ( status, is_test, avg_rating:merchants_avg_rating, review_count:merchants_review_count )")
      .eq("status", "active")
      .limit(5);
    expect(error).toBeNull();
  });

  it("an anonymous visitor cannot read merchant_private at all", async () => {
    const { data } = await anon.from("merchant_private").select("phone").eq("merchant_id", merchantAId);
    expect(data ?? []).toEqual([]);
  });

  it("a signed-in customer cannot read another merchant's contact details either", async () => {
    const token = await signIn(env.qaCustomerEmail, env.qaCustomerPassword);
    const customer = createClient(env.supabaseUrl, env.anonKey, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } });
    const { data } = await customer.from("merchant_private").select("phone, email").eq("merchant_id", merchantAId);
    expect(data ?? []).toEqual([]);
  });

  it("the merchant's own owner still reads their contact details", async () => {
    const token = await signIn(env.qaMerchantAEmail, env.qaMerchantAPassword);
    const owner = createClient(env.supabaseUrl, env.anonKey, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await owner.from("merchant_private").select("phone, email").eq("merchant_id", merchantAId);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data![0].email).toBe(env.qaMerchantAEmail);
  });
});
