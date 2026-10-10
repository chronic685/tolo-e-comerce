import { useEffect, useRef, type ReactNode } from "react";
import { useTranslation } from "../i18n/useTranslation";

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  /** What will happen, and (for a destructive action) what cannot be undone. */
  message?: ReactNode;
  confirmLabel: string;
  /** Shown on the confirm button while the action runs. */
  busyLabel?: string;
  busy?: boolean;
  /** "destructive" paints the confirm button red; "primary" is the brand navy. */
  tone?: "destructive" | "primary";
  onConfirm: () => void;
  onCancel: () => void;
}

/** The confirmation dialog the dashboards share: a centered card over a dimmed
 * backdrop, the same look the admin Categories delete confirmation had before it
 * was lifted here. Escape and the backdrop cancel; focus moves to Cancel on open
 * (the safe choice for a destructive prompt) and returns to whatever opened it. */
export function ConfirmDialog({ open, title, message, confirmLabel, busyLabel, busy = false, tone = "destructive", onConfirm, onCancel }: ConfirmDialogProps) {
  const { t } = useTranslation();
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previouslyFocused?.focus?.();
    };
  }, [open, busy, onCancel]);

  if (!open) return null;

  const confirmClass =
    tone === "destructive"
      ? "bg-red-600 text-white hover:bg-red-700"
      : "bg-navy text-white hover:bg-navy-dark dark:bg-navy-light dark:hover:bg-navy";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={busy ? undefined : onCancel} aria-hidden="true" />
      <div role="alertdialog" aria-modal="true" aria-label={title} className="relative bg-white dark:bg-navy-dark rounded-lg p-5 max-w-sm w-full shadow-popover">
        <h2 className="font-semibold mb-2 dark:text-gray-100">{title}</h2>
        {message && <div className="text-sm text-gray-600 dark:text-gray-400 mb-4">{message}</div>}
        <div className="flex gap-2 justify-end">
          <button
            ref={cancelRef}
            onClick={onCancel}
            disabled={busy}
            className="text-sm border dark:border-white/20 dark:text-gray-200 px-3 py-1.5 rounded-md hover:bg-gray-50 dark:hover:bg-white/5 disabled:opacity-60"
          >
            {t("common.cancel")}
          </button>
          <button onClick={onConfirm} disabled={busy} className={`text-sm px-3 py-1.5 rounded-md disabled:opacity-60 ${confirmClass}`}>
            {busy && busyLabel ? busyLabel : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
