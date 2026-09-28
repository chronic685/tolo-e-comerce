import { afterEach, beforeAll, describe, expect, inject, it } from "vitest";
import { anonClient, env, serviceClient, signIn } from "../env.ts";

// Group 2, item 7 (migration 0059): stores.prep_time_minutes, shown to
// customers on the storefront as "Usually ready in ~X minutes".
const db = serviceClient();

describe("merchant prep time (stores.prep_time_minutes, migration 0059)", () => {
  let storeId: string;
  let storeSlug: string;
  let originalPrepTime: number | null;
  let originalStatus: string;

  beforeAll(async () => {
    await signIn(env.qaMerchantAEmail, env.qaMerchantAPassword);
    const fixtures = inject("qaFixtures");
    const { data: store, error } = await db
      .from("stores")
      .select("id, slug, status, prep_time_minutes")
      .eq("merchant_id", fixtures.merchantAId)
      .maybeSingle();
    expect(error).toBeNull();
    expect(store, "QA merchant A must have a stores row for this test").not.toBeNull();
    storeId = store!.id;
    storeSlug = store!.slug;
    originalPrepTime = store!.prep_time_minutes;
    originalStatus = store!.status;
  });

  afterEach(async () => {
    await db.from("stores").update({ prep_time_minutes: originalPrepTime, status: originalStatus }).eq("id", storeId);
  });

  it("rejects a non-positive prep time (the stores_prep_time_minutes_positive constraint)", async () => {
    const { error } = await db.from("stores").update({ prep_time_minutes: 0 }).eq("id", storeId);
    expect(error).not.toBeNull();
  });

  it("accepts a positive prep time and null (unset) alike", async () => {
    const { error: setError } = await db.from("stores").update({ prep_time_minutes: 15 }).eq("id", storeId);
    expect(setError).toBeNull();

    const { error: unsetError } = await db.from("stores").update({ prep_time_minutes: null }).eq("id", storeId);
    expect(unsetError).toBeNull();
  });

  it("is readable by an anonymous customer once the store is active (same RLS every other public store column already uses)", async () => {
    await db.from("stores").update({ status: "active", prep_time_minutes: 25 }).eq("id", storeId);

    const { data, error } = await anonClient().from("stores").select("prep_time_minutes").eq("slug", storeSlug).maybeSingle();
    expect(error).toBeNull();
    expect(data!.prep_time_minutes).toBe(25);
  });
});
