import { useContext } from "react";
import { I18nContext, type I18nContextValue } from "./I18nProvider";

export function useTranslation(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useTranslation must be used within an I18nProvider");
  return ctx;
}
