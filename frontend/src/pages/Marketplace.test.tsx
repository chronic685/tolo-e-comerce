import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@tolo/ui";
import type { Product } from "../types";

const product = (id: string, name: string, customer_price: number): Product => ({
  id,
  merchant_id: "m1",
  store_id: "m1",
  category_id: "c1",
  name,
  slug: id,
  description: null,
  base_price: customer_price - 100,
  discount_price: null,
  status: "published",
  customer_price,
  product_variants: [],
  product_images: [],
});

const catalogue = vi.hoisted(() => ({
  listCategories: vi.fn(),
  listProducts: vi.fn(),
  listShops: vi.fn(),
  getMerchantRatings: vi.fn(),
}));

vi.mock("../data/catalogue", () => ({ catalogue }));
// Banners belong to the content module and still come from Supabase.
vi.mock("../lib/supabase", () => ({
  supabase: { from: () => ({ select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: [] }) }) }) }) },
}));
vi.mock("../lib/AuthContext", () => ({ useAuth: () => ({ user: null }) }));
vi.mock("../lib/FavoritesContext", () => ({ useFavorites: () => ({ enabled: false, isFavorite: () => false, toggleFavorite: () => {} }) }));

import { Marketplace } from "./Marketplace";

function renderAt(url: string) {
  return render(
    <I18nProvider>
      <MemoryRouter initialEntries={[url]}>
        <Marketplace />
      </MemoryRouter>
    </I18nProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  catalogue.listCategories.mockResolvedValue([{ id: "c1", name: "Clothing", name_am: null, slug: "clothing", icon: "shirt", color: "navy" }]);
  catalogue.listShops.mockResolvedValue({ items: [], total: 0 });
  catalogue.getMerchantRatings.mockResolvedValue(new Map());
  catalogue.listProducts.mockResolvedValue({ items: [product("p1", "Leather shoes", 2205)], total: 1 });
});

describe("Marketplace over the catalogue adapter", () => {
  it("searches with the typed text, category, customer-price range and sort, and shows what comes back", async () => {
    renderAt("/?q=hoe&category=c1&min_price=1000&max_price=2300&sort=price_asc");

    expect(await screen.findByText("Leather shoes")).toBeTruthy();
    expect(catalogue.listProducts).toHaveBeenCalledWith({
      page: 1,
      pageSize: expect.any(Number),
      categoryId: "c1",
      search: "hoe",
      minPrice: 1000,
      maxPrice: 2300,
      sort: "price_asc",
    });
    // shop-name matches for the same text
    expect(catalogue.listShops).toHaveBeenCalledWith({ page: 1, pageSize: 6, search: "hoe" });
  });

  it("leaves the price bounds out when they are empty and sorts newest first by default", async () => {
    renderAt("/?q=shoe");
    await screen.findByText("Leather shoes");
    const query = catalogue.listProducts.mock.calls[0][0];
    expect(query.minPrice).toBeUndefined();
    expect(query.maxPrice).toBeUndefined();
    expect(query.sort).toBe("newest");
  });

  it("the home page asks for featured products and a row of shops, and none of the filters", async () => {
    catalogue.listProducts.mockImplementation(async (q: { featured?: boolean }) =>
      q.featured ? { items: [product("f1", "Featured kettle", 900)], total: 1 } : { items: [product("p1", "Leather shoes", 2205)], total: 1 },
    );
    catalogue.listShops.mockResolvedValue({ items: [{ id: "m1", merchant_id: "m1", name: "Bole Fashion", slug: "m1", logo_url: null }], total: 1 });
    renderAt("/");
    expect(await screen.findByText("Featured kettle")).toBeTruthy();
    await waitFor(() => expect(catalogue.listShops).toHaveBeenCalledWith({ page: 1, pageSize: 12 }));
    expect(catalogue.listProducts).toHaveBeenCalledWith({ page: 1, pageSize: 10, featured: true });
  });
});
