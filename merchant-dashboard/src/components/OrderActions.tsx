import { useRef, useState } from "react";
import { Button, Sheet, translateServerError, useTranslation } from "@tolo/ui";
import { advanceOrder, nextStep, reasonNote, rejectStep, REJECT_REASONS } from "../lib/orderFlow";

// After a step succeeds the same button turns into the NEXT step's button (new -> "Ready for pickup" ...). A second tap that
// lands just after the first response would then press the next step by accident, so each order is held for a moment after
// it moves. Module-level, so it survives the row being re-rendered or remounted by the refresh that follows.
const COOLDOWN_MS = 1200;
const movedAt = new Map<string, number>();
const coolingDown = (orderId: string) => Date.now() - (movedAt.get(orderId) ?? 0) < COOLDOWN_MS;

interface Props {
  orderId: string;
  status: string;
  /** Called after the order really moved (or was already there), with the status it is now in. */
  onMoved: (newStatus: string) => void;
  /** Smaller buttons for a table row. */
  compact?: boolean;
  selfPickup?: boolean;
}

/** The one primary button for an order, plus a secondary "Reject / Cancel" with a reason picker. Used on the order list rows,
 * the order detail page and the new-order alert, so every screen offers the same step with the same label.
 *
 * Tapping twice is harmless: the button locks the moment it is pressed (a ref, so even two taps in the same render are
 * ignored) and the server treats a repeat as a no-op. A failure leaves the button where it was, with the reason and a Retry. */
export function OrderActions({ orderId, status, onMoved, compact = false, selfPickup = false }: Props) {
  const { t } = useTranslation();
  const lock = useRef(false);
  const [saving, setSaving] = useState(false);
  const [cooling, setCooling] = useState(false);
  const [error, setError] = useState<{ message: string; retry: () => void } | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reasonKey, setReasonKey] = useState(REJECT_REASONS[0].key);
  const [detail, setDetail] = useState("");

  const next = nextStep(status, { selfPickup });
  const reject = rejectStep(status);
  if (!next && !reject) return null;

  async function run(to: string, note?: string) {
    if (lock.current || coolingDown(orderId)) return;
    lock.current = true;
    setSaving(true);
    setError(null);
    const result = await advanceOrder(orderId, to, note);
    lock.current = false;
    setSaving(false);
    if (!result.ok) {
      setRejecting(false); // so the reason and Retry are visible, not behind the dialog
      setError({ message: result.error ? translateServerError(result.error, t) : t("merchant.actionFailed"), retry: () => run(to, note) });
      return;
    }
    setRejecting(false);
    movedAt.set(orderId, Date.now());
    setCooling(true);
    setTimeout(() => setCooling(false), COOLDOWN_MS);
    onMoved(to);
  }

  const size = compact ? "sm" : "default";

  return (
    <div className={compact ? "flex flex-col items-end gap-1" : "mb-4"}>
      <div className={`flex gap-2 ${compact ? "flex-wrap justify-end" : ""}`}>
        {next && (
          <Button size={size} onClick={() => run(next.to)} disabled={saving || cooling} data-testid="primary-order-action">
            {saving ? t("common.saving") : t(next.labelKey)}
          </Button>
        )}
        {reject && (
          <Button size={size} variant="outline" onClick={() => setRejecting(true)} disabled={saving} data-testid="reject-order-action">
            {t(reject.labelKey)}
          </Button>
        )}
      </div>
      {error && (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">
          {error.message}{" "}
          <button type="button" onClick={error.retry} className="underline font-medium">
            {t("merchant.retry")}
          </button>
        </p>
      )}
      {/* Same bottom-sheet pattern as the other pickers in the dashboards (a centered card on wide screens). */}
      <Sheet
        open={rejecting}
        onClose={() => !saving && setRejecting(false)}
        title={reject ? t(reject.confirmKey) : ""}
        desktopVariant="center"
        footer={
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" onClick={() => setRejecting(false)} disabled={saving}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={() => reject && run(reject.to, reasonNote(reasonKey, detail))}
              disabled={saving}
              data-testid="confirm-reject"
            >
              {saving ? t("common.saving") : reject ? t(reject.confirmKey) : ""}
            </Button>
          </div>
        }
      >
        <div className="space-y-2">
          <label className="block text-xs text-gray-600 dark:text-gray-400">
            {t("merchant.reason.label")}
            <select value={reasonKey} onChange={(e) => setReasonKey(e.target.value)} className="mt-1 w-full border rounded-md px-2 py-1.5 text-sm bg-white dark:bg-navy dark:border-white/20 dark:text-gray-100">
              {REJECT_REASONS.map((r) => (
                <option key={r.key} value={r.key}>
                  {t(r.labelKey)}
                </option>
              ))}
            </select>
          </label>
          <input
            value={detail}
            onChange={(e) => setDetail(e.target.value)}
            maxLength={200}
            placeholder={t("merchant.reason.detail")}
            aria-label={t("merchant.reason.detail")}
            className="w-full border rounded-md px-2 py-1.5 text-sm bg-white dark:bg-navy dark:border-white/20 dark:text-gray-100"
          />
          <p className="text-xs text-gray-500 dark:text-gray-400">{t("merchant.reason.refundNote")}</p>
        </div>
      </Sheet>
    </div>
  );
}
