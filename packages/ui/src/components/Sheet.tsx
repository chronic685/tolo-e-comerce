import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "../lib/cn";
import { useTranslation } from "../i18n/useTranslation";

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  footer?: ReactNode;
  /** Rendered as a bottom sheet on phones always; on md+ screens, "side"
   * (default) docks it to the right as a panel, "center" keeps it a
   * bottom sheet at every width (e.g. a mobile-only picker). */
  desktopVariant?: "side" | "center";
  /** "wide" gives a side panel room for a detail view (about 44rem on desktop, taller on phones). */
  width?: "narrow" | "wide";
}

/** Bottom sheet on phones, side panel or bottom sheet on desktop depending
 * on `desktopVariant`. Used for filters, and any other mobile-first
 * overlay picker. */
export function Sheet({ open, onClose, title, children, footer, desktopVariant = "side", width = "narrow" }: SheetProps) {
  const { t } = useTranslation();
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Item 9 (WCAG AA): a modal must move focus into itself on open and give
  // it back to whatever opened it on close, or a keyboard/screen-reader
  // user's focus is left stranded behind an overlay they can't see past.
  useEffect(() => {
    if (!open) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    const firstFocusable = panelRef.current?.querySelector<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    (firstFocusable ?? panelRef.current)?.focus();
    return () => {
      previouslyFocused.current?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  const panelPosition =
    desktopVariant === "side"
      ? `inset-x-0 bottom-0 rounded-t-2xl md:inset-y-0 md:right-0 md:left-auto ${width === "wide" ? "md:w-[44rem]" : "md:w-96"} md:rounded-none`
      : "inset-x-0 bottom-0 rounded-t-2xl";

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        tabIndex={-1}
        className={cn(
          "absolute bg-white dark:bg-navy-dark flex flex-col md:max-h-none shadow-xl outline-none",
          width === "wide" ? "max-h-[92vh]" : "max-h-[85vh]",
          panelPosition,
        )}
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b dark:border-white/10 flex-shrink-0">
          <h2 className="font-semibold text-sm dark:text-gray-100">{title}</h2>
          <button onClick={onClose} aria-label={t("common.close")} className="p-1 text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-100">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="overflow-y-auto flex-1 p-4">{children}</div>
        {footer && <div className="border-t dark:border-white/10 p-4 flex-shrink-0">{footer}</div>}
      </div>
    </div>
  );
}
