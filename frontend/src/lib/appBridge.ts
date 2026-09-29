// Bridge to the native app shell when this site is loaded inside it
// (?embed=app). Every function here is a no-op outside embed mode.

const EMBED_STORAGE_KEY = "tolo_embed_mode";

/** Call once at app startup (main.tsx). Detects ?embed=app and persists it
 * to sessionStorage so embed mode survives in-app navigation even once a
 * link drops the query param — every page must stay deep-linkable on its
 * own URL, so we can't rely on the param always being present. */
export function initEmbedMode(): void {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams(window.location.search);
  if (params.get("embed") === "app") {
    window.sessionStorage.setItem(EMBED_STORAGE_KEY, "1");
  }
}

export function isEmbedMode(): boolean {
  if (typeof window === "undefined") return false;
  return window.sessionStorage.getItem(EMBED_STORAGE_KEY) === "1";
}

/** Pure URL builder, kept separate from the actual navigation side effect
 * so it can be tested without jsdom having to navigate to a toloapp:// URL. */
export function buildAppUrl(event: string, params: Record<string, string> = {}): string {
  const query = new URLSearchParams(params).toString();
  return `toloapp://${event}${query ? `?${query}` : ""}`;
}

function sendToApp(event: string, params?: Record<string, string>): void {
  if (!isEmbedMode()) return;
  window.location.href = buildAppUrl(event, params);
}

/** Tells the native app shell to close this embedded view. */
export function closeApp(): void {
  sendToApp("close");
}

/** Tells the native app shell a checkout just succeeded. */
export function notifyOrderPlaced(orderId: string): void {
  sendToApp("order-placed", { orderId });
}

/** Hands off to the native app to collect payment via the customer's
 * in-app wallet. */
export function openPayment(orderId: string, amount: number): void {
  sendToApp("open-payment", { orderId, amount: String(amount) });
}
