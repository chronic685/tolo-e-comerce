import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ErrorBoundary } from "./ErrorBoundary";
import { I18nProvider } from "../i18n/I18nProvider";

function Bomb(): never {
  throw new Error("boom");
}

describe("ErrorBoundary", () => {
  it("renders children normally when nothing throws", () => {
    render(
      <I18nProvider>
        <ErrorBoundary>
          <p>all good</p>
        </ErrorBoundary>
      </I18nProvider>,
    );
    expect(screen.getByText("all good")).toBeInTheDocument();
  });

  it("catches a render error and shows a translated fallback instead of crashing the app", () => {
    // React logs the error to the console in dev mode regardless -- silence
    // it so the test output isn't cluttered with an expected error.
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <I18nProvider>
        <ErrorBoundary>
          <Bomb />
        </ErrorBoundary>
      </I18nProvider>,
    );
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    consoleSpy.mockRestore();
  });

  it("calls onError with the thrown error", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const onError = vi.fn();
    render(
      <I18nProvider>
        <ErrorBoundary onError={onError}>
          <Bomb />
        </ErrorBoundary>
      </I18nProvider>,
    );
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toBeInstanceOf(Error);
    consoleSpy.mockRestore();
  });
});
