import { Languages } from "lucide-react";
import { useTranslation } from "../i18n/useTranslation";
import { LOCALES, LOCALE_LABELS } from "../i18n/types";
import { cn } from "../lib/cn";

export interface LanguageSwitcherProps {
  className?: string;
  /** "compact" is a single-tap toggle (icon + current language) meant for
   * a tight header bar; "full" spells out both options as separate
   * buttons, meant for a mobile menu panel where there's room and a
   * second tap to open a dropdown would be one tap too many. */
  variant?: "compact" | "full";
}

/** Item 2 (Group 5): "Language switcher in every app header and in the
 * mobile menu." One shared component so the three apps' headers/menus
 * can't drift out of sync on behavior -- each just picks compact vs full
 * for its own layout. */
export function LanguageSwitcher({ className, variant = "compact" }: LanguageSwitcherProps) {
  const { locale, setLocale, t } = useTranslation();

  if (variant === "full") {
    return (
      <div className={cn("flex items-center gap-2", className)}>
        <span className="text-xs text-gray-500">{t("language.label")}</span>
        <div className="flex gap-1">
          {LOCALES.map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => setLocale(l)}
              aria-pressed={locale === l}
              className={cn(
                "px-2.5 py-1 rounded-md text-xs font-medium border",
                locale === l ? "bg-navy text-white border-navy" : "bg-white text-gray-600 border-gray-200",
              )}
            >
              {LOCALE_LABELS[l]}
            </button>
          ))}
        </div>
      </div>
    );
  }

  const other = LOCALES.find((l) => l !== locale) ?? locale;

  return (
    <button
      type="button"
      onClick={() => setLocale(other)}
      className={cn("inline-flex items-center gap-1.5 text-sm", className)}
      aria-label={t("language.label")}
      title={t("language.label")}
    >
      <Languages className="w-4 h-4 flex-shrink-0" />
      {LOCALE_LABELS[locale]}
    </button>
  );
}
