import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DateRangePicker } from "./DateRangePicker";
import { I18nProvider } from "../i18n/I18nProvider";
import { lastNDays } from "../lib/dateRange";

describe("DateRangePicker", () => {
  it("marks the matching preset button as pressed", () => {
    render(
      <I18nProvider>
        <DateRangePicker range={lastNDays(30)} onChange={vi.fn()} />
      </I18nProvider>,
    );
    expect(screen.getByRole("button", { name: "30d" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "7d" })).toHaveAttribute("aria-pressed", "false");
  });

  it("clicking a preset calls onChange with that range", () => {
    const onChange = vi.fn();
    render(
      <I18nProvider>
        <DateRangePicker range={lastNDays(30)} onChange={onChange} />
      </I18nProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "7d" }));
    expect(onChange).toHaveBeenCalledWith(lastNDays(7));
  });

  it("no preset is pressed once a custom date is chosen", () => {
    const range = lastNDays(30);
    render(
      <I18nProvider>
        <DateRangePicker range={{ start: range.start, end: new Date(range.end.getTime() - 86_400_000) }} onChange={vi.fn()} />
      </I18nProvider>,
    );
    for (const label of ["7d", "30d", "90d"]) {
      expect(screen.getByRole("button", { name: label })).toHaveAttribute("aria-pressed", "false");
    }
  });
});
