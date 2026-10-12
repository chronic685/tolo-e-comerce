import { afterEach, describe, expect, it, vi } from "vitest";
import { createToloApi } from "@tolo/api-client";

afterEach(() => {
  vi.resetModules();
});

async function load(env: Record<string, unknown>, supabaseData: unknown[] = []) {
  vi.resetModules();
  const fetchMock = vi.fn(async () => new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } }));
  vi.doMock("../../lib/api", () => ({ toloApi: createToloApi(env, { fetch: fetchMock as unknown as typeof fetch }) }));
  const from = vi.fn(() => {
    const builder: Record<string, unknown> = new Proxy({}, { get: (_t, m: string) => (m === "then" ? (r: (v: unknown) => void) => r({ data: supabaseData }) : () => builder) });
    return builder;
  });
  vi.doMock("../../lib/supabase", () => ({ supabase: { from } }));
  const { merchantProducts } = await import("./index");
  return { merchantProducts, fetchMock, from };
}

describe("the merchant-products backend switch", () => {
  it("uses Supabase by default", async () => {
    const { merchantProducts, fetchMock, from } = await load({}, [{ id: "c1" }]);
    expect(await merchantProducts.categories()).toEqual([{ id: "c1" }]);
    expect(from).toHaveBeenCalledWith("categories");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses the API when VITE_BACKEND_MERCHANT_PRODUCTS=api, without touching Supabase", async () => {
    const { merchantProducts, fetchMock, from } = await load({ VITE_BACKEND_MERCHANT_PRODUCTS: "api" });
    expect(await merchantProducts.categories()).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(from).not.toHaveBeenCalled();
  });

  it("does not move when another module is switched", async () => {
    const { merchantProducts, fetchMock } = await load({ VITE_BACKEND_CATALOGUE: "api", VITE_BACKEND_ORDERS: "api" });
    await merchantProducts.categories();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
