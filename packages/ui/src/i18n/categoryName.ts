import { useCallback } from "react";
import { useTranslation } from "./useTranslation";

export interface LocalizableName {
  name: string;
  name_am?: string | null;
}

/** A category's name in the given locale. The Amharic name is data on the row
 * (categories.name_am), not a UI string, so it can't go through t(); an empty
 * one falls back to the English name. */
export function localizedName(item: LocalizableName, locale: string): string {
  return (locale === "am" && item.name_am?.trim()) || item.name;
}

/** Returns a function that renders a category's name for the current language. */
export function useCategoryName(): (item: LocalizableName) => string {
  const { locale } = useTranslation();
  return useCallback((item: LocalizableName) => localizedName(item, locale), [locale]);
}
