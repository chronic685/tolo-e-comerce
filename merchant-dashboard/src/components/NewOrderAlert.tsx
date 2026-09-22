import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { useMerchant } from "../lib/MerchantContext";

interface PendingOrder {
  id: string;
  merchant_payable: number;
  created_at: string;
  items: { product_name_snapshot: string; quantity: number; variant_attributes_snapshot: Record<string, string> }[];
}

const VIBRATE_PATTERN = [300, 150, 300, 150, 300];
const DEFAULT_ALERT_SETTINGS = { vibrate: true, reminder_interval_minutes: 2, escalate_after_minutes: 5 };

// Best-effort beep via Web Audio API — no audio file to host, but browsers
// require a prior user gesture before sound will actually play. Since the
// merchant already interacted with the page to log in, this generally works,
// but isn't guaranteed on every browser if the tab has been idle a long time.
function playBeep() {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 880;
    gain.gain.value = 0.25;
    osc.start();
    osc.stop(ctx.currentTime + 0.35);
  } catch {
    // Audio not available — vibration and the visual banner still fire.
  }
}

export function NewOrderAlert() {
  const { merchant } = useMerchant();
  const [queue, setQueue] = useState<PendingOrder[]>([]);
  const [acknowledging, setAcknowledging] = useState(false);
  const [alertSettings, setAlertSettings] = useState(DEFAULT_ALERT_SETTINGS);
  const vibrateTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    // Admin-configurable (spec section 22) — vibration on/off and the
    // reminder cadence come from Settings, not a hardcoded constant.
    supabase
      .from("system_settings")
      .select("value")
      .eq("key", "merchant_new_order_alerts")
      .maybeSingle()
      .then(({ data }) => {
        if (data?.value) setAlertSettings({ ...DEFAULT_ALERT_SETTINGS, ...(data.value as object) });
      });
  }, []);

  const loadOrder = useCallback(async (merchantOrderId: string) => {
    const { data: mo } = await supabase
      .from("merchant_orders")
      .select("id, merchant_payable, created_at, status, scheduled_for")
      .eq("id", merchantOrderId)
      .maybeSingle();
    if (!mo || mo.status !== "new") return;
    // A scheduled order doesn't need the same "drop everything, act now"
    // full-screen/vibrate/beep treatment a same-day order gets — it still
    // shows up normally in Orders.tsx (with its scheduled time clearly
    // labeled), and escalate_unacknowledged_orders() (migration 0048) is
    // the real backstop that pages Ops if it's still unacknowledged as its
    // delivery window actually approaches, even if this tab isn't open.
    if (mo.scheduled_for) return;

    const { data: items } = await supabase
      .from("order_items")
      .select("product_name_snapshot, quantity, variant_attributes_snapshot")
      .eq("merchant_order_id", merchantOrderId);

    setQueue((prev) => (prev.some((o) => o.id === mo.id) ? prev : [...prev, { ...mo, items: items ?? [] }]));
  }, []);

  // Catch orders that arrived while the merchant wasn't looking (page reload,
  // tab was closed, etc) — not just ones that arrive live.
  useEffect(() => {
    if (!merchant) return;
    supabase
      .from("merchant_orders")
      .select("id")
      .eq("merchant_id", merchant.id)
      .eq("status", "new")
      .then(({ data }) => {
        (data ?? []).forEach((row) => loadOrder(row.id));
      });
  }, [merchant, loadOrder]);

  useEffect(() => {
    if (!merchant) return;
    const channel = supabase
      .channel(`merchant-orders-${merchant.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "merchant_orders", filter: `merchant_id=eq.${merchant.id}` },
        (payload) => loadOrder((payload.new as { id: string }).id),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [merchant, loadOrder]);

  const current = queue[0];

  useEffect(() => {
    if (!current) {
      if (vibrateTimer.current) clearInterval(vibrateTimer.current);
      vibrateTimer.current = null;
      return;
    }
    playBeep();
    if (alertSettings.vibrate) navigator.vibrate?.(VIBRATE_PATTERN);
    vibrateTimer.current = setInterval(() => {
      playBeep();
      if (alertSettings.vibrate) navigator.vibrate?.(VIBRATE_PATTERN);
    }, Math.max(1, alertSettings.reminder_interval_minutes) * 60_000);
    return () => {
      if (vibrateTimer.current) clearInterval(vibrateTimer.current);
    };
  }, [current, alertSettings]);

  async function handleReceived() {
    if (!current) return;
    setAcknowledging(true);
    await supabase.functions.invoke("order-status", {
      body: { merchant_order_id: current.id, status: "accepted" },
    });
    setAcknowledging(false);
    navigator.vibrate?.(0);
    setQueue((prev) => prev.filter((o) => o.id !== current.id));
  }

  if (!current) return null;

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg max-w-sm w-full p-6 shadow-2xl border-2 border-red-500">
        <p className="text-xs font-bold text-red-600 tracking-wide mb-1">NEW ORDER</p>
        <h2 className="text-xl font-bold mb-1">Order #{current.id.slice(0, 8)}</h2>
        <p className="text-xs text-gray-500 mb-4">{new Date(current.created_at).toLocaleTimeString()}</p>

        <div className="space-y-1 mb-4 border-t border-b py-3">
          {current.items.map((item, idx) => (
            <div key={idx} className="flex justify-between text-sm">
              <span>
                {item.product_name_snapshot}
                {Object.values(item.variant_attributes_snapshot ?? {}).length > 0 &&
                  ` (${Object.values(item.variant_attributes_snapshot).join(" / ")})`}{" "}
                × {item.quantity}
              </span>
            </div>
          ))}
        </div>

        <div className="flex justify-between font-semibold mb-5">
          <span>You'll receive</span>
          <span>{current.merchant_payable.toFixed(2)} ETB</span>
        </div>

        <button
          onClick={handleReceived}
          disabled={acknowledging}
          className="w-full bg-navy text-white py-3 rounded-md font-bold text-lg hover:bg-navy-dark disabled:opacity-60"
        >
          {acknowledging ? "..." : "ORDER RECEIVED"}
        </button>
        {queue.length > 1 && <p className="text-xs text-gray-400 text-center mt-2">+{queue.length - 1} more new order(s)</p>}
      </div>
    </div>
  );
}
