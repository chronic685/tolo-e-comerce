import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { OfflineBanner } from "./OfflineBanner";
import { I18nProvider } from "../i18n/I18nProvider";

function setOnline(value: boolean) {
  Object.defineProperty(navigator, "onLine", { value, configurable: true });
}

describe("OfflineBanner", () => {
  afterEach(() => {
    setOnline(true);
  });

  it("renders nothing while online", () => {
    setOnline(true);
    render(
      <I18nProvider>
        <OfflineBanner />
      </I18nProvider>,
    );
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("shows the banner immediately when mounted while already offline", () => {
    setOnline(false);
    render(
      <I18nProvider>
        <OfflineBanner />
      </I18nProvider>,
    );
    expect(screen.getByRole("status")).toHaveTextContent("offline");
  });

  it("appears on an offline event and disappears again on online", () => {
    setOnline(true);
    render(
      <I18nProvider>
        <OfflineBanner />
      </I18nProvider>,
    );
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    act(() => {
      setOnline(false);
      window.dispatchEvent(new Event("offline"));
    });
    expect(screen.getByRole("status")).toBeInTheDocument();

    act(() => {
      setOnline(true);
      window.dispatchEvent(new Event("online"));
    });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
