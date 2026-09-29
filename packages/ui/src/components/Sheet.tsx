import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "../lib/cn";

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
}

/** Bottom sheet on phones, side panel or bottom sheet on desktop depending
 * on `desktopVariant`. Used for filters, and any other mobile-first
 * overlay picker. */
export function Sheet({ open, onClose, title, children, footer, desktopVariant = "side" }: SheetProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const panelPosition =
    desktopVariant === "side"
      ? "inset-x-0 bottom-0 rounded-t-2xl md:inset-y-0 md:right-0 md:left-auto md:w-96 md:rounded-none"
      : "inset-x-0 bottom-0 rounded-t-2xl";

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
      <div
        className={cn(
          "absolute bg-white flex flex-col max-h-[85vh] md:max-h-none shadow-xl",
          panelPosition,
        )}
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b flex-shrink-0">
          <h2 className="font-semibold text-sm">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="p-1 text-gray-500 hover:text-gray-800">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="overflow-y-auto flex-1 p-4">{children}</div>
        {footer && <div className="border-t p-4 flex-shrink-0">{footer}</div>}
      </div>
    </div>
  );
}
