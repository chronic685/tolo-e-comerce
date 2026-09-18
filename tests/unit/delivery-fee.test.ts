import { describe, expect, it } from "vitest";
import { serviceClient } from "../env.ts";

// Integration tests against resolve_delivery_fee() / haversine_km(), the
// authoritative PL/pgSQL functions used inside create_order() — see
// commission.test.ts for why these aren't reimplemented in JS.
describe("delivery fee calculation: resolve_delivery_fee()", () => {
  const db = serviceClient();

  it("falls back to the flat platform fee far outside any delivery zone", async () => {
    const { data: settings } = await db.from("system_settings").select("value").eq("key", "delivery").maybeSingle();
    const expectedFee = Number((settings?.value as Record<string, unknown> | null)?.base_fee ?? 0);

    // Null Island (0,0) — not a real delivery zone in this platform.
    const { data, error } = await db.rpc("resolve_delivery_fee", {
      p_latitude: 0,
      p_longitude: 0,
      p_order_subtotal: 1,
    });
    expect(error).toBeNull();
    expect(Number(data)).toBe(expectedFee);
  });

  it("charges the zone's own fee when the point falls inside an active zone", async () => {
    const { data: zone } = await db
      .from("delivery_zones")
      .select("center_latitude, center_longitude, delivery_fee, free_delivery_threshold")
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();

    if (!zone) {
      console.warn("NOT COVERED: no active delivery zone configured — skipping zone-based fee test.");
      return;
    }

    const belowThreshold = zone.free_delivery_threshold != null ? Number(zone.free_delivery_threshold) - 1 : 1;
    const { data, error } = await db.rpc("resolve_delivery_fee", {
      p_latitude: zone.center_latitude,
      p_longitude: zone.center_longitude,
      p_order_subtotal: Math.max(belowThreshold, 1),
    });
    expect(error).toBeNull();
    expect(Number(data)).toBe(Number(zone.delivery_fee));
  });

  it("returns zero once the order subtotal meets the zone's free-delivery threshold", async () => {
    const { data: zone } = await db
      .from("delivery_zones")
      .select("center_latitude, center_longitude, free_delivery_threshold")
      .eq("is_active", true)
      .not("free_delivery_threshold", "is", null)
      .limit(1)
      .maybeSingle();

    if (!zone) {
      console.warn("NOT COVERED: no active delivery zone has a free_delivery_threshold configured — skipping.");
      return;
    }

    const { data, error } = await db.rpc("resolve_delivery_fee", {
      p_latitude: zone.center_latitude,
      p_longitude: zone.center_longitude,
      p_order_subtotal: Number(zone.free_delivery_threshold),
    });
    expect(error).toBeNull();
    expect(Number(data)).toBe(0);
  });
});

describe("distance calculation: haversine_km()", () => {
  const db = serviceClient();

  it("returns zero for identical coordinates", async () => {
    const { data, error } = await db.rpc("haversine_km", { lat1: 9.03, lon1: 38.74, lat2: 9.03, lon2: 38.74 });
    expect(error).toBeNull();
    expect(Number(data)).toBeCloseTo(0, 5);
  });

  it("returns a known distance for two real-world points (Addis Ababa to Adama, ~70km)", async () => {
    const { data, error } = await db.rpc("haversine_km", { lat1: 9.03, lon1: 38.74, lat2: 8.54, lon2: 39.27 });
    expect(error).toBeNull();
    expect(Number(data)).toBeGreaterThan(60);
    expect(Number(data)).toBeLessThan(85);
  });
});
