import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TrendChart } from "./TrendChart";

const data = [
  { label: "Mon", value: 10 },
  { label: "Tue", value: 30 },
  { label: "Wed", value: 20 },
];

describe("TrendChart", () => {
  it("renders an accessible sr-only table with every point's exact value", () => {
    render(<TrendChart data={data} ariaLabel="Weekly revenue" formatValue={(v) => `${v} ETB`} />);
    const table = screen.getByRole("table", { hidden: true });
    expect(table).toHaveTextContent("Mon");
    expect(table).toHaveTextContent("30 ETB");
  });

  it("shows a tooltip with the exact value on hover", () => {
    render(<TrendChart data={data} ariaLabel="Weekly revenue" formatValue={(v) => `${v} ETB`} />);
    expect(screen.queryAllByText(/30 ETB/)).toHaveLength(1); // only the sr-only table, no tooltip yet
    fireEvent.mouseEnter(screen.getByRole("button", { name: "Tue: 30 ETB" }));
    expect(screen.getAllByText(/30 ETB/)).toHaveLength(2); // table + visible tooltip
  });

  it("shows a tooltip on keyboard focus, not just hover", () => {
    render(<TrendChart data={data} ariaLabel="Weekly revenue" formatValue={(v) => `${v} ETB`} />);
    fireEvent.focus(screen.getByRole("button", { name: "Mon: 10 ETB" }));
    expect(screen.getAllByText(/10 ETB/)).toHaveLength(2);
  });

  it("labels the svg with the chart's title for screen readers", () => {
    render(<TrendChart data={data} ariaLabel="Weekly revenue" />);
    expect(screen.getByRole("img", { name: "Weekly revenue" })).toBeInTheDocument();
  });
});
