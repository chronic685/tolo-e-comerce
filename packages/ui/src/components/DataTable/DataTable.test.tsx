import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DataTable, type DataTableColumn } from "./DataTable";
import { I18nProvider } from "../../i18n/I18nProvider";

interface Order {
  id: string;
  customer: string;
  total: number;
}

const orders: Order[] = [
  { id: "1", customer: "Abel", total: 30 },
  { id: "2", customer: "Selam", total: 10 },
  { id: "3", customer: "Marta", total: 20 },
];

const columns: DataTableColumn<Order>[] = [
  { key: "customer", header: "Customer", render: (o) => o.customer, filterValue: (o) => o.customer, csvValue: (o) => o.customer },
  { key: "total", header: "Total", render: (o) => `${o.total} ETB`, sortValue: (o) => o.total, csvValue: (o) => o.total, align: "right" },
];

function renderTable(props: Partial<Parameters<typeof DataTable<Order>>[0]> = {}) {
  const result = render(
    <I18nProvider>
      <DataTable storageKey="test.orders" columns={columns} rows={orders} getRowId={(o) => o.id} {...props} />
    </I18nProvider>,
  );
  // The component renders a desktop <table> and a phone card list side by
  // side unconditionally (CSS `hidden md:block` decides which one a real
  // browser shows; jsdom does no layout, so both exist in the tree at
  // once) -- tests that care about row content/structure scope to the
  // table specifically instead of asserting against the whole document.
  const table = () => within(result.container.querySelector("table")!);
  return { ...result, table };
}

describe("DataTable", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it("renders every row's cells", () => {
    const { table } = renderTable();
    expect(table().getByText("Abel")).toBeInTheDocument();
    expect(table().getByText("30 ETB")).toBeInTheDocument();
  });

  it("filters rows by the free-text search box", () => {
    const { table } = renderTable();
    fireEvent.change(screen.getByPlaceholderText("Filter…"), { target: { value: "sela" } });
    expect(table().getByText("Selam")).toBeInTheDocument();
    expect(table().queryByText("Abel")).not.toBeInTheDocument();
  });

  it("clicking a sortable header sorts ascending, then descending, then off", () => {
    renderTable();
    const header = screen.getByRole("button", { name: /Total/ });

    fireEvent.click(header);
    let rows = screen.getAllByRole("row").slice(1); // drop header row
    expect(within(rows[0]).getByText("Selam")).toBeInTheDocument(); // 10 first, ascending

    fireEvent.click(header);
    rows = screen.getAllByRole("row").slice(1);
    expect(within(rows[0]).getByText("Abel")).toBeInTheDocument(); // 30 first, descending
  });

  it("hides a column via the Columns menu and persists the choice", () => {
    const { table } = renderTable();
    fireEvent.click(screen.getByRole("button", { name: /Columns/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Total" }));
    expect(table().queryByText("30 ETB")).not.toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem("tolo_table_test.orders_hidden_columns")!)).toEqual(["total"]);
  });

  it("selecting rows shows the bulk action bar and invokes the action with the selected rows", () => {
    const onAction = vi.fn();
    const { table } = renderTable({ bulkActions: [{ label: "Archive", onAction }] });
    fireEvent.click(table().getByRole("checkbox", { name: "row-1" }));
    expect(screen.getByText("1 selected")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    expect(onAction).toHaveBeenCalledWith([orders[0]]);
  });

  it("the select-all checkbox selects and deselects every visible row", () => {
    renderTable({ bulkActions: [{ label: "Archive", onAction: vi.fn() }] });
    fireEvent.click(screen.getByRole("checkbox", { name: "Select all rows" }));
    expect(screen.getByText("3 selected")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: "Select all rows" }));
    expect(screen.queryByText(/selected/)).not.toBeInTheDocument();
  });

  it("shows the empty message when nothing matches the filter", () => {
    renderTable();
    fireEvent.change(screen.getByPlaceholderText("Filter…"), { target: { value: "nobody" } });
    expect(screen.getByText("No matching rows")).toBeInTheDocument();
  });

  it("Export CSV triggers a download (anchor click) when csvFilename is set", () => {
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    renderTable({ csvFilename: "orders.csv" });
    fireEvent.click(screen.getByRole("button", { name: /Export CSV/ }));
    expect(clickSpy).toHaveBeenCalled();
    clickSpy.mockRestore();
  });

  it("saves the current filter under a name (via prompt) and lists it for reuse", () => {
    vi.spyOn(window, "prompt").mockReturnValue("Big orders");
    renderTable();
    fireEvent.change(screen.getByPlaceholderText("Filter…"), { target: { value: "abel" } });
    fireEvent.click(screen.getByRole("button", { name: "Saved filters" }));
    fireEvent.click(screen.getByText("Save current filter…"));
    // The dropdown stays open after saving -- the new entry should already
    // be listed without needing to reopen it.
    expect(screen.getByText("Big orders")).toBeInTheDocument();
    vi.restoreAllMocks();
  });
});
