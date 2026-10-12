import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@tolo/ui";
import type { Product } from "../types";

const adapter = vi.hoisted(() => ({
  list: vi.fn(),
  listAll: vi.fn(),
  setVisible: vi.fn(),
  archive: vi.fn(),
  restore: vi.fn(),
  hasOrders: vi.fn(),
  remove: vi.fn(),
}));

vi.mock("../data/merchantProducts", () => ({ merchantProducts: adapter }));
vi.mock("../lib/supabase", () => ({
  supabase: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null }) }) }) }) },
}));
vi.mock("../lib/MerchantContext", () => ({
  useMerchant: () => ({ merchant: { id: "m1" }, store: { id: "s1", status: "active" } }),
}));

import { Products } from "./Products";

const product = (over: Partial<Product> = {}): Product => ({
  id: "p1",
  merchant_id: "m1",
  store_id: "s1",
  category_id: null,
  name: "Leather shoes",
  slug: "leather-shoes",
  description: null,
  base_price: 2400,
  discount_price: null,
  status: "published",
  archived_at: null,
  archived_by_role: null,
  product_variants: [{ id: "v1", product_id: "p1", sku: null, attributes: {}, price: 2400, discount_price: null, is_default: true, inventory: { stock_quantity: 7, reserved_quantity: 0, available_quantity: 7 } }],
  product_images: [],
  categories: null,
  ...over,
});

function renderPage() {
  return render(
    <I18nProvider>
      <MemoryRouter>
        <Products />
      </MemoryRouter>
    </I18nProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  adapter.list.mockResolvedValue({ items: [product()], total: 1 });
  adapter.setVisible.mockResolvedValue({ ok: true });
  adapter.archive.mockResolvedValue({ ok: true, count: 1 });
  adapter.hasOrders.mockResolvedValue({ ok: true, hasOrders: false });
});
afterEach(cleanup);

describe("Products over the merchant-products adapter", () => {
  it("lists the active tab for the shop and shows the product with its stock", async () => {
    renderPage();
    expect((await screen.findAllByText("Leather shoes")).length).toBeGreaterThan(0);
    expect(adapter.list).toHaveBeenCalledWith({ merchantId: "m1", storeId: "s1" }, "active", 1, expect.any(Number));
    expect(screen.getAllByText("7").length).toBeGreaterThan(0);
  });

  it("hides a live product through the adapter and shows it as hidden", async () => {
    renderPage();
    await screen.findAllByText("Leather shoes"); // the table and the phone cards each show it
    fireEvent.click(screen.getAllByRole("button", { name: "Hide" })[0]);
    await waitFor(() => expect(adapter.setVisible).toHaveBeenCalledWith(["p1"], false));
    expect((await screen.findAllByRole("button", { name: "Show" })).length).toBeGreaterThan(0);
  });

  it("offers archiving when deleting a product that orders refer to", async () => {
    adapter.hasOrders.mockResolvedValue({ ok: true, hasOrders: true });
    renderPage();
    await screen.findAllByText("Leather shoes"); // the table and the phone cards each show it
    fireEvent.click(screen.getAllByRole("button", { name: "Delete" })[0]);
    await waitFor(() => expect(adapter.hasOrders).toHaveBeenCalledWith("p1"));
    expect(adapter.remove).not.toHaveBeenCalled();
    expect((await screen.findAllByText(/archive/i)).length).toBeGreaterThan(0);
  });

  it("falls back to the blocked-delete dialog when the delete itself says orders refer to the product", async () => {
    adapter.remove.mockResolvedValue({ ok: false, error: "ordered", hasOrders: true });
    renderPage();
    await screen.findAllByText("Leather shoes"); // the table and the phone cards each show it
    fireEvent.click(screen.getAllByRole("button", { name: "Delete" })[0]);
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete permanently" }));
    await waitFor(() => expect(adapter.remove).toHaveBeenCalledWith("p1"));
    expect(adapter.archive).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getAllByRole("button", { name: /archive/i }).length).toBeGreaterThan(0));
  });
});
