import { useEffect, useRef } from "react";
import { supabase } from "./supabase";

/**
 * Keeps a screen in step with orders that change somewhere else (the driver picks one up, another device accepts it,
 * a customer cancels): re-runs `reload` on every merchant_orders change that matches `filter`, once more each time the
 * realtime channel (re)connects, and on a slow poll as a backstop while the tab is visible, since a dropped socket
 * delivers nothing and says nothing. `reload` should refresh in place, never blank the screen.
 */
export function useOrderRefresh(channelName: string, filter: string | undefined, reload: () => void, pollMs = 30_000) {
  const latest = useRef(reload);
  latest.current = reload;

  useEffect(() => {
    if (!filter) return;
    let pending: ReturnType<typeof setTimeout> | null = null;
    // A burst of changes (a bulk accept) triggers one reload, not one per row.
    const schedule = () => {
      if (pending) return;
      pending = setTimeout(() => {
        pending = null;
        latest.current();
      }, 400);
    };

    const channel = supabase
      .channel(channelName)
      .on("postgres_changes", { event: "*", schema: "public", table: "merchant_orders", filter }, schedule)
      .subscribe((status) => {
        if (status === "SUBSCRIBED") schedule();
      });

    const poll = setInterval(() => {
      if (document.visibilityState === "visible") latest.current();
    }, pollMs);

    return () => {
      if (pending) clearTimeout(pending);
      clearInterval(poll);
      supabase.removeChannel(channel);
    };
  }, [channelName, filter, pollMs]);
}
