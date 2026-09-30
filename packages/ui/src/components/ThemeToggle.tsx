import { Moon, Sun } from "lucide-react";
import { useTheme } from "../theme/useTheme";
import { useTranslation } from "../i18n/useTranslation";
import { cn } from "../lib/cn";

export interface ThemeToggleProps {
  className?: string;
  /** "compact" is a single-tap icon toggle for a tight header bar; "full"
   * adds the current mode's label, meant for a mobile menu panel with room
   * to spare -- same split as LanguageSwitcher's variant prop. */
  variant?: "compact" | "full";
}

/** Dark mode toggle, persisted the same way the language switcher persists
 * locale -- one shared component so the three apps' headers/menus can't
 * drift out of sync on behavior. */
export function ThemeToggle({ className, variant = "compact" }: ThemeToggleProps) {
  const { theme, toggleTheme } = useTheme();
  const { t } = useTranslation();
  const isDark = theme === "dark";
  const Icon = isDark ? Sun : Moon;
  const label = isDark ? t("theme.switchToLight") : t("theme.switchToDark");

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-pressed={isDark}
      aria-label={label}
      title={label}
      className={cn("inline-flex items-center gap-1.5 text-sm", className)}
    >
      <Icon className="w-4 h-4 flex-shrink-0" />
      {variant === "full" && (isDark ? t("theme.dark") : t("theme.light"))}
    </button>
  );
}
