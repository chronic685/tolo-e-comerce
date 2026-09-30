import { useEffect, useState } from "react";
import { WifiOff } from "lucide-react";
import { useTranslation } from "../i18n/useTranslation";

/** Fixed top banner shown whenever the browser reports it has lost network
 * connectivity — a customer or merchant mid-checkout/mid-order-update
 * otherwise has no signal that their next tap is about to silently fail.
 * `navigator.onLine` is a best-effort browser signal (it can be wrong on
 * flaky connections), but it costs nothing to show and correctly disappears
 * the moment the browser fires `online` again. */
export function OfflineBanner() {
  const { t } = useTranslation();
  const [offline, setOffline] = useState(() => typeof navigator !== "undefined" && !navigator.onLine);

  useEffect(() => {
    const goOffline = () => setOffline(true);
    const goOnline = () => setOffline(false);
    window.addEventListener("offline", goOffline);
    window.addEventListener("online", goOnline);
    return () => {
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("online", goOnline);
    };
  }, []);

  if (!offline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed top-0 inset-x-0 z-[60] bg-yellow-500 text-yellow-950 text-sm font-medium px-4 py-2 flex items-center justify-center gap-2"
    >
      <WifiOff className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
      {t("offline.message")}
    </div>
  );
}
