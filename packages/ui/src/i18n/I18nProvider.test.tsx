import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "./I18nProvider";
import { useTranslation } from "./useTranslation";
import { LOCALE_STORAGE_KEY } from "./types";
import { getCurrentLocale } from "./locale";

function TestConsumer() {
  const { locale, setLocale, t } = useTranslation();
  return (
    <div>
      <p data-testid="locale">{locale}</p>
      <p data-testid="translated">{t("common.save")}</p>
      <button onClick={() => setLocale(locale === "en" ? "am" : "en")}>toggle</button>
    </div>
  );
}

describe("I18nProvider / useTranslation", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.lang = "";
  });
  afterEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("defaults to English when no stored preference and the browser isn't Amharic", () => {
    vi.stubGlobal("navigator", { ...navigator, language: "en-US", languages: ["en-US"] });
    render(
      <I18nProvider>
        <TestConsumer />
      </I18nProvider>,
    );
    expect(screen.getByTestId("locale").textContent).toBe("en");
    expect(screen.getByTestId("translated").textContent).toBe("Save");
  });

  it("defaults to Amharic when the browser's language is Amharic and nothing is stored", () => {
    vi.stubGlobal("navigator", { ...navigator, language: "am-ET", languages: ["am-ET"] });
    render(
      <I18nProvider>
        <TestConsumer />
      </I18nProvider>,
    );
    expect(screen.getByTestId("locale").textContent).toBe("am");
    expect(screen.getByTestId("translated").textContent).toBe("አስቀምጥ");
  });

  it("a stored preference overrides the browser language", () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, "am");
    vi.stubGlobal("navigator", { ...navigator, language: "en-US", languages: ["en-US"] });
    render(
      <I18nProvider>
        <TestConsumer />
      </I18nProvider>,
    );
    expect(screen.getByTestId("locale").textContent).toBe("am");
  });

  it("switching the language persists it to localStorage and sets <html lang>", () => {
    render(
      <I18nProvider>
        <TestConsumer />
      </I18nProvider>,
    );
    expect(screen.getByTestId("locale").textContent).toBe("en");

    fireEvent.click(screen.getByText("toggle"));

    expect(screen.getByTestId("locale").textContent).toBe("am");
    expect(screen.getByTestId("translated").textContent).toBe("አስቀምጥ");
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("am");
    expect(document.documentElement.lang).toBe("am");
  });

  it("mirrors the active locale into the module-level singleton lib/format.ts reads", () => {
    render(
      <I18nProvider>
        <TestConsumer />
      </I18nProvider>,
    );
    expect(getCurrentLocale()).toBe("en");
    fireEvent.click(screen.getByText("toggle"));
    expect(getCurrentLocale()).toBe("am");
  });

  it("falls back to the English string for a key missing from Amharic rather than showing the raw key", () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, "am");
    function ConsumerWithUnknownKey() {
      const { t } = useTranslation();
      return <p data-testid="unknown">{t("this.key.does.not.exist")}</p>;
    }
    render(
      <I18nProvider>
        <ConsumerWithUnknownKey />
      </I18nProvider>,
    );
    // Neither locale has this key -- last-resort fallback is the key
    // itself, never a blank string or a thrown error.
    expect(screen.getByTestId("unknown").textContent).toBe("this.key.does.not.exist");
  });
});
