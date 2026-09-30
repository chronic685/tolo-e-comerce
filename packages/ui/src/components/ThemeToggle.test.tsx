import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeToggle } from "./ThemeToggle";
import { I18nProvider } from "../i18n/I18nProvider";
import { ThemeProvider } from "../theme/ThemeProvider";

function renderToggle(variant?: "compact" | "full") {
  return render(
    <I18nProvider>
      <ThemeProvider>
        <ThemeToggle variant={variant} />
      </ThemeProvider>
    </I18nProvider>,
  );
}

describe("ThemeToggle", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove("dark");
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query }) as MediaQueryList);
  });
  afterEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove("dark");
    vi.unstubAllGlobals();
  });

  it("starts in light mode with an accessible label to switch to dark", () => {
    renderToggle();
    expect(screen.getByRole("button", { name: "Switch to dark mode" })).toBeInTheDocument();
  });

  it("toggles to dark mode on click and flips its label/aria-pressed", () => {
    renderToggle();
    const button = screen.getByRole("button");
    fireEvent.click(button);
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(screen.getByRole("button", { name: "Switch to light mode" })).toHaveAttribute("aria-pressed", "true");
  });

  it("the 'full' variant also renders the current mode's label", () => {
    renderToggle("full");
    expect(screen.getByText("Light")).toBeInTheDocument();
  });
});
