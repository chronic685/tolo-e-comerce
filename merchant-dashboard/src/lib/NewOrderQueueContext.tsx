import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { supabase } from "./supabase";
import { useMerchant } from "./MerchantContext";
import { loadSoundEnabled, persistSoundEnabled } from "./soundPreference";
import { advanceOrder } from "./orderFlow";

export interface PendingOrder {
  id: string;
  merchant_payable: number;
  created_at: string;
  orders: { order_number: number } | null;
  items: { product_name_snapshot: string; quantity: number; variant_attributes_snapshot: Record<string, string> }[];
}

interface NewOrderQueueState {
  queue: PendingOrder[];
  /** Accepts the order and starts preparing it, in one step. Resolves false (and keeps the order in the queue) if it failed. */
  acknowledge: (id: string) => Promise<boolean>;
  soundEnabled: boolean;
  setSoundEnabled: (enabled: boolean) => void;
  alertSettings: { vibrate: boolean; reminder_interval_minutes: number; escalate_after_minutes: number };
}

const NewOrderQueueContext = createContext<NewOrderQueueState | undefined>(undefined);

const DEFAULT_ALERT_SETTINGS = { vibrate: true, reminder_interval_minutes: 2, escalate_after_minutes: 5 };

/** Owns the merchant's live "new order" queue in one place so both the
 * full-screen NewOrderAlert modal and a header badge (item 6) read the same
 * state instead of each running their own duplicate fetch/subscription.
 * Split out of NewOrderAlert.tsx, which previously owned this directly. */
export function NewOrderQueueProvider({ children }: { children: ReactNode }) {
  const { merchant } = useMerchant();
  const [queue, setQueue] = useState<PendingOrder[]>([]);
  const [alertSettings, setAlertSettings] = useState(DEFAULT_ALERT_SETTINGS);
  const [soundEnabled, setSoundEnabledState] = useState(() => loadSoundEnabled());

  const setSoundEnabled = useCallback((enabled: boolean) => {
    setSoundEnabledState(enabled);
    persistSoundEnabled(enabled);
  }, []);

  useEffect(() => {
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
      .select("id, merchant_payable, created_at, status, scheduled_for, orders ( order_number )")
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

    const ordersEmbed = (Array.isArray(mo.orders) ? mo.orders[0] : mo.orders) as { order_number: number } | undefined;
    setQueue((prev) =>
      prev.some((o) => o.id === mo.id) ? prev : [...prev, { ...mo, orders: ordersEmbed ?? null, items: items ?? [] }],
    );
  }, []);

  const catchUp = useCallback(async () => {
    if (!merchant) return;
    const { data } = await supabase.from("merchant_orders").select("id").eq("merchant_id", merchant.id).eq("status", "new");
    (data ?? []).forEach((row) => loadOrder(row.id));
  }, [merchant, loadOrder]);

  // Catch orders that arrived while the merchant wasn't looking (page
  // reload, tab was closed, etc) — not just ones that arrive live.
  useEffect(() => {
    catchUp();
  }, [catchUp]);

  useEffect(() => {
    if (!merchant) return;
    const channel = supabase
      .channel(`merchant-orders-${merchant.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "merchant_orders", filter: `merchant_id=eq.${merchant.id}` },
        (payload) => loadOrder((payload.new as { id: string }).id),
      )
      .subscribe((status) => {
        // Item 6: "no missed orders after reconnect." The channel above
        // auto-resubscribes after a dropped connection (network blip, the
        // laptop sleeping), but any INSERT that happened while disconnected
        // was never delivered as an event — re-run the same catch-up query
        // on every fresh SUBSCRIBED, not just once at mount.
        if (status === "SUBSCRIBED") catchUp();
      });
    return () => {
      supabase.removeChannel(channel);
    };
  }, [merchant, loadOrder, catchUp]);

  const current = queue[0];
  const vibrateTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!current || !soundEnabled) {
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
  }, [current, alertSettings, soundEnabled]);

  const acknowledge = useCallback(async (id: string) => {
    // One tap: straight to "processing" (accepted and preparing together). A repeat is a no-op on the server.
    const result = await advanceOrder(id, "processing");
    if (!result.ok) return false;
    navigator.vibrate?.(0);
    setQueue((prev) => prev.filter((o) => o.id !== id));
    return true;
  }, []);

  const value = useMemo(
    () => ({ queue, acknowledge, soundEnabled, setSoundEnabled, alertSettings }),
    [queue, acknowledge, soundEnabled, setSoundEnabled, alertSettings],
  );

  return <NewOrderQueueContext.Provider value={value}>{children}</NewOrderQueueContext.Provider>;
}

export function useNewOrderQueue() {
  const ctx = useContext(NewOrderQueueContext);
  if (!ctx) throw new Error("useNewOrderQueue must be used within NewOrderQueueProvider");
  return ctx;
}

const VIBRATE_PATTERN = [300, 150, 300, 150, 300];

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
