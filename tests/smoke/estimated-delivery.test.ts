import { createClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it } from "vitest";
import { env, serviceClient, signIn } from "../env.ts";

// Phase 5d, item 9: the new order-confirmation screen shows an estimated
// delivery time when one can be derived. get_estimated_delivery_minutes
// (migration 0038) mirrors resolve_delivery_fee's nearest-active-zone
// lookup but returns only estimated_delivery_minutes, and is deliberately
// granted to authenticated (unlike resolve_delivery_fee/haversine_km,
// locked down in migration 0035) since a coarse ETA has no pricing
// information worth protecting.
const db = serviceClient();

// Coordinates picked to not plausibly fall inside a real, already-configured
// delivery zone — isolates this test from whatever production zones exist.
const REMOTE_LAT = 5.55;
const REMOTE_LON = 45.55;

describe("get_estimated_delivery_minutes", () => {
  const createdZoneIds: string[] = [];

  afterEach(async () => {
    for (const id of createdZoneIds.splice(0)) {
      await db.from("delivery_zones").delete().eq("id", id);
    }
  });

  it("is callable by an authenticated customer (unlike resolve_delivery_fee/haversine_km)", async () => {
    const token = await signIn(env.qaCustomerEmail, env.qaCustomerPassword);
    const client = createClient(env.supabaseUrl, env.anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data, error } = await client.rpc("get_estimated_delivery_minutes", { p_latitude: REMOTE_LAT, p_longitude: REMOTE_LON });
    expect(error).toBeNull();
    expect(data).toBeNull(); // no zone covers this point yet
  });

  it("returns null when no coordinates are given", async () => {
    const { data, error } = await db.rpc("get_estimated_delivery_minutes", { p_latitude: null, p_longitude: null });
    expect(error).toBeNull();
    expect(data).toBeNull();
  });

  it("returns the nearest active zone's estimated_delivery_minutes", async () => {
    const { data: zone, error } = await db
      .from("delivery_zones")
      .insert({
        name: "QA TEST — Phase 5d ETA zone",
        center_latitude: REMOTE_LAT,
        center_longitude: REMOTE_LON,
        radius_km: 5,
        delivery_fee: 0,
        estimated_delivery_minutes: 45,
        is_active: true,
      })
      .select("id")
      .single();
    expect(error).toBeNull();
    createdZoneIds.push(zone!.id);

    const { data: minutes, error: rpcError } = await db.rpc("get_estimated_delivery_minutes", {
      p_latitude: REMOTE_LAT,
      p_longitude: REMOTE_LON,
    });
    expect(rpcError).toBeNull();
    expect(minutes).toBe(45);
  });

  it("ignores an inactive zone even if it's the closest one", async () => {
    const { data: zone, error } = await db
      .from("delivery_zones")
      .insert({
        name: "QA TEST — Phase 5d inactive ETA zone",
        center_latitude: REMOTE_LAT,
        center_longitude: REMOTE_LON,
        radius_km: 5,
        delivery_fee: 0,
        estimated_delivery_minutes: 999,
        is_active: false,
      })
      .select("id")
      .single();
    expect(error).toBeNull();
    createdZoneIds.push(zone!.id);

    const { data: minutes, error: rpcError } = await db.rpc("get_estimated_delivery_minutes", {
      p_latitude: REMOTE_LAT,
      p_longitude: REMOTE_LON,
    });
    expect(rpcError).toBeNull();
    expect(minutes).toBeNull();
  });
});
