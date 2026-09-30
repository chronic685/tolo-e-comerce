import { createRef } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommandPalette, type CommandPaletteHandle, type CommandPaletteItem } from "./CommandPalette";
import { I18nProvider } from "../../i18n/I18nProvider";

const pages: CommandPaletteItem[] = [
  { key: "orders", label: "Orders", to: "/orders", group: "Pages" },
  { key: "products", label: "Products", to: "/products", group: "Pages" },
  { key: "settings", label: "Settings", to: "/settings", group: "Pages" },
];

function renderPalette(props: Partial<Parameters<typeof CommandPalette>[0]> = {}) {
  return render(
    <I18nProvider>
      <MemoryRouter initialEntries={["/"]}>
        <CommandPalette pages={pages} {...props} />
        <Routes>
          <Route path="*" element={<p>current path: rendered</p>} />
        </Routes>
      </MemoryRouter>
    </I18nProvider>,
  );
}

function cmdK() {
  fireEvent.keyDown(document, { key: "k", metaKey: true });
}

describe("CommandPalette", () => {
  afterEach(() => vi.useRealTimers());

  it("is closed until Cmd/Ctrl+K is pressed", () => {
    renderPalette();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    cmdK();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("Ctrl+K also opens it (not just Cmd)", () => {
    renderPalette();
    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("Escape closes it", () => {
    renderPalette();
    cmdK();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("lists every page when the query is empty", () => {
    renderPalette();
    cmdK();
    expect(screen.getByText("Orders")).toBeInTheDocument();
    expect(screen.getByText("Products")).toBeInTheDocument();
    expect(screen.getByText("Settings")).toBeInTheDocument();
  });

  it("filters pages by label as you type", () => {
    renderPalette();
    cmdK();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "prod" } });
    expect(screen.getByText("Products")).toBeInTheDocument();
    expect(screen.queryByText("Orders")).not.toBeInTheDocument();
  });

  it("never shows a page the caller didn't include -- permission filtering is entirely the caller's job", () => {
    renderPalette({ pages: pages.filter((p) => p.key !== "settings") });
    cmdK();
    expect(screen.queryByText("Settings")).not.toBeInTheDocument();
  });

  it("ArrowDown/Enter navigates to the selected page and closes the palette", () => {
    renderPalette();
    cmdK();
    const combobox = screen.getByRole("combobox");
    fireEvent.keyDown(combobox, { key: "ArrowDown" });
    fireEvent.keyDown(combobox, { key: "Enter" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("calls onSearch after a debounce once the query reaches the minimum length, and lists results", async () => {
    const onSearch = vi.fn().mockResolvedValue([{ key: "order-1", label: "Order TL-1001", to: "/orders/1", group: "Orders" }]);
    renderPalette({ onSearch });
    cmdK();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "TL-100" } });
    expect(onSearch).not.toHaveBeenCalled();
    await waitFor(() => expect(onSearch).toHaveBeenCalledWith("TL-100"));
    await waitFor(() => expect(screen.getByText("Order TL-1001")).toBeInTheDocument());
  });

  it("does not call onSearch for a query shorter than the minimum length", () => {
    const onSearch = vi.fn();
    renderPalette({ onSearch });
    cmdK();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "a" } });
    expect(onSearch).not.toHaveBeenCalled();
  });

  it("opens via the imperative ref handle, for a visible click trigger", () => {
    const ref = createRef<CommandPaletteHandle>();
    render(
      <I18nProvider>
        <MemoryRouter>
          <CommandPalette ref={ref} pages={pages} />
        </MemoryRouter>
      </I18nProvider>,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    act(() => ref.current?.open());
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
