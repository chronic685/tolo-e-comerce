import { afterEach, describe, expect, it, vi } from "vitest";
import { createToloApi } from "@tolo/api-client";

afterEach(() => {
  vi.resetModules();
});

async function loadCatalogue(env: Record<string, unknown>, supabaseData: unknown[] = []) {
  vi.resetModules();
  const fetchMock = vi.fn(async () => new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } }));
  vi.doMock("../../lib/api", () => ({ toloApi: createToloApi(env, { fetch: fetchMock as unknown as typeof fetch }) }));
  const from = vi.fn(() => {
    const builder: Record<string, unknown> = new Proxy({}, { get: (_t, m: string) => (m === "then" ? (r: (v: unknown) => void) => r({ data: supabaseData }) : () => builder) });
    return builder;
  });
  vi.doMock("../../lib/supabase", () => ({ supabase: { from } }));
  const { catalogue } = await import("./index");
  return { catalogue, fetchMock, from };
}

describe("the catalogue backend switch", () => {
  it("uses Supabase by default", async () => {
    const { catalogue, fetchMock, from } = await loadCatalogue({}, [{ id: "c1" }]);
    expect(await catalogue.listCategories()).toEqual([{ id: "c1" }]);
    expect(from).toHaveBeenCalledWith("categories");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses the API when VITE_BACKEND_CATALOGUE=api, without touching Supabase", async () => {
    const { catalogue, fetchMock, from } = await loadCatalogue({ VITE_BACKEND_CATALOGUE: "api" });
    expect(await catalogue.listCategories()).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(from).not.toHaveBeenCalled();
  });

  it("does not move when another module is switched", async () => {
    const { catalogue, fetchMock } = await loadCatalogue({ VITE_BACKEND_ORDERS: "api" });
    await catalogue.listCategories();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
