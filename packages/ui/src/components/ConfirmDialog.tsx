import { useEffect, useRef, useState, type ReactNode } from "react";
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
  /** For a drastic action: the admin must type this exact text (a word, or the name of what is being deleted)
   * before the confirm button works. Case-sensitive, so "DELETE" means DELETE. */
  requireText?: string;
  /** Label above the field when requireText is set, e.g. 'Type "DELETE" to confirm'. */
  requireTextLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/** The confirmation dialog the dashboards share: a centered card over a dimmed
 * backdrop, the same look the admin Categories delete confirmation had before it
 * was lifted here. Escape and the backdrop cancel; focus moves to Cancel on open
 * (the safe choice for a destructive prompt) and returns to whatever opened it. */
export function ConfirmDialog({ open, title, message, confirmLabel, busyLabel, busy = false, tone = "destructive", requireText, requireTextLabel, onConfirm, onCancel }: ConfirmDialogProps) {
  const { t } = useTranslation();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [typed, setTyped] = useState("");

  // A fresh, empty field every time the dialog opens.
  useEffect(() => {
    if (open) setTyped("");
  }, [open]);

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
        {requireText && (
          <label className="block mb-4">
            <span className="block text-xs text-gray-600 dark:text-gray-400 mb-1">{requireTextLabel}</span>
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              disabled={busy}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              className="w-full border rounded-md px-3 py-2 text-sm dark:bg-navy dark:border-white/20 dark:text-gray-100"
            />
          </label>
        )}
        <div className="flex gap-2 justify-end">
          <button
            ref={cancelRef}
            onClick={onCancel}
            disabled={busy}
            className="text-sm border dark:border-white/20 dark:text-gray-200 px-3 py-1.5 rounded-md hover:bg-gray-50 dark:hover:bg-white/5 disabled:opacity-60"
          >
            {t("common.cancel")}
          </button>
          <button
            onClick={onConfirm}
            disabled={busy || (requireText !== undefined && typed !== requireText)}
            className={`text-sm px-3 py-1.5 rounded-md disabled:opacity-60 ${confirmClass}`}
          >
            {busy && busyLabel ? busyLabel : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
