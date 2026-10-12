import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@tolo/ui";
import type { Product } from "../types";

vi.mock("../lib/AuthContext", () => ({ useAuth: () => ({ user: null }) }));
vi.mock("../lib/FavoritesContext", () => ({ useFavorites: () => ({ enabled: false, isFavorite: () => false, toggleFavorite: () => {} }) }));
vi.mock("../lib/supabase", () => ({ supabase: {} }));
vi.mock("../data/catalogue", () => ({ catalogue: {} }));

import { ProductCard } from "./ProductCard";

const product = (over: Partial<Product> = {}): Product => ({
  id: "p1",
  merchant_id: "m1",
  store_id: "m1",
  category_id: null,
  name: "Leather shoes",
  slug: "leather-shoes",
  description: null,
  base_price: 2400,
  discount_price: null,
  status: "published",
  customer_price: 2205,
  product_variants: [],
  product_images: [],
  ...over,
});

function renderCard(p: Product) {
  return render(
    <I18nProvider>
      <MemoryRouter>
        <ProductCard product={p} />
      </MemoryRouter>
    </I18nProvider>,
  );
}

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe("ProductCard stock label", () => {
  it("says out of stock when the API list says nothing is in stock", () => {
    renderCard(product({ in_stock: false }));
    expect(screen.getByText("Out of stock")).toBeTruthy();
  });

  it("says nothing when it is in stock, or when the list gives no stock information", () => {
    renderCard(product({ in_stock: true }));
    expect(screen.queryByText("Out of stock")).toBeNull();
    renderCard(product());
    expect(screen.queryByText("Out of stock")).toBeNull();
  });

  it("still reads the Supabase variant's own status", () => {
    const variant = { id: "v1", sku: null, attributes: {}, price: 1, discount_price: null, is_default: true, customer_price: 1, stock_status: "out_of_stock" as const };
    renderCard(product({ product_variants: [variant] }));
    expect(screen.getByText("Out of stock")).toBeTruthy();
  });

  it("links to the product and its shop by slug", () => {
    renderCard(product({ stores: { name: "Bole Fashion", slug: "bole-fashion-a1b2c3d4" } }));
    expect(screen.getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual(expect.arrayContaining(["/products/leather-shoes", "/stores/bole-fashion-a1b2c3d4"]));
  });
});
