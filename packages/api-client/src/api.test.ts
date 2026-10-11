import { describe, expect, it, vi } from "vitest";
import { BACKEND_MODULES, DEFAULT_API_BASE_URL, DEV_TOKEN_KEY, backendEnvName, backendFor, createToloApi, createTokenSource, selectBackend } from "./index";

const memory = (value: string | null) => ({ getItem: (key: string) => (key === DEV_TOKEN_KEY ? value : null) });

describe("per-module backend switch", () => {
  it("builds the variable name from the module", () => {
    expect(backendEnvName("catalogue")).toBe("VITE_BACKEND_CATALOGUE");
    expect(backendEnvName("merchant-products")).toBe("VITE_BACKEND_MERCHANT_PRODUCTS");
  });

  it("defaults every module to supabase", () => {
    for (const m of BACKEND_MODULES) expect(backendFor({}, m)).toBe("supabase");
  });

  it("switches only the module that says api, and only for exactly api", () => {
    const env = { VITE_BACKEND_CATALOGUE: "api", VITE_BACKEND_ORDERS: " API ", VITE_BACKEND_ADMIN: "apis", VITE_BACKEND_FINANCE: "" };
    expect(backendFor(env, "catalogue")).toBe("api");
    expect(backendFor(env, "orders")).toBe("api");
    expect(backendFor(env, "admin")).toBe("supabase");
    expect(backendFor(env, "finance")).toBe("supabase");
    expect(backendFor(env, "content")).toBe("supabase");
  });

  it("builds only the chosen implementation", () => {
    const supabase = vi.fn(() => "S");
    const api = vi.fn(() => "A");
    expect(selectBackend({}, "catalogue", { supabase, api })).toBe("S");
    expect(api).not.toHaveBeenCalled();
    expect(selectBackend({ VITE_BACKEND_CATALOGUE: "api" }, "catalogue", { supabase, api })).toBe("A");
    expect(supabase).toHaveBeenCalledTimes(1);
  });
});

describe("token source", () => {
  it("reads the dev token in development", () => {
    expect(createTokenSource({ DEV: true }, memory("  abc.def  "))()).toBe("abc.def");
  });

  it("never reads storage outside development", () => {
    const getItem = vi.fn(() => "abc");
    expect(createTokenSource({ DEV: false }, { getItem })()).toBeNull();
    expect(createTokenSource({}, { getItem })()).toBeNull();
    expect(getItem).not.toHaveBeenCalled();
  });

  it("is null when there is no token or storage fails", () => {
    expect(createTokenSource({ DEV: true }, memory(null))()).toBeNull();
    expect(createTokenSource({ DEV: true }, memory("   "))()).toBeNull();
    expect(createTokenSource({ DEV: true }, { getItem: () => { throw new Error("blocked"); } })()).toBeNull();
  });
});

describe("api client", () => {
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });

  it("calls the configured base address with the bearer token", async () => {
    const fetchMock = vi.fn(async (_request: Request) => json([]));
    const api = createToloApi({ DEV: true, VITE_API_BASE_URL: "http://api.test:5080/" }, { fetch: fetchMock as unknown as typeof fetch, storage: memory("tok123") });
    const { data, error } = await api.client.GET("/api/customer/categories");
    expect(error).toBeUndefined();
    expect(data).toEqual([]);
    const request = fetchMock.mock.calls[0][0];
    expect(request.url).toBe("http://api.test:5080/api/customer/categories");
    expect(request.headers.get("Authorization")).toBe("Bearer tok123");
  });

  it("browses anonymously when there is no token and defaults the address", async () => {
    const fetchMock = vi.fn(async (_request: Request) => json([]));
    const api = createToloApi({}, { fetch: fetchMock as unknown as typeof fetch, storage: memory("tok123") });
    expect(api.baseUrl).toBe(DEFAULT_API_BASE_URL);
    await api.client.GET("/api/customer/categories");
    const request = fetchMock.mock.calls[0][0];
    expect(request.url).toBe(`${DEFAULT_API_BASE_URL}/api/customer/categories`);
    expect(request.headers.get("Authorization")).toBeNull();
  });

  it("exposes the module switch", () => {
    const api = createToloApi({ VITE_BACKEND_CATALOGUE: "api" });
    expect(api.backendFor("catalogue")).toBe("api");
    expect(api.backendFor("orders")).toBe("supabase");
    expect(api.select("catalogue", { supabase: () => 1, api: () => 2 })).toBe(2);
  });
});

describe("withQuery", () => {
  it("sends only the parameters that have a value", async () => {
    const { withQuery } = await import("./index");
    const fetchMock = vi.fn(async (_request: Request) => new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } }));
    const api = createToloApi({}, { fetch: fetchMock as unknown as typeof fetch });
    await api.client.GET("/api/customer/products", withQuery({ q: "shoe", page: 2, category_id: undefined, featured: false, min_price: null, empty: "" }));
    expect(new URL(fetchMock.mock.calls[0][0].url).search).toBe("?q=shoe&page=2&featured=false");
  });
});
