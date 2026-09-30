// Per-browser mute toggle for the new-order alert sound/vibration (item 6:
// "sound toggle") -- separate from the admin-configured
// merchant_new_order_alerts.vibrate setting in NewOrderQueueContext, which
// is a platform-wide default. This is the individual merchant's own
// override on top of it, same best-effort try/catch localStorage shape as
// every other persisted preference in this codebase (i18n/detectLocale.ts,
// theme/detectTheme.ts).
const SOUND_STORAGE_KEY = "tolo_merchant_alert_sound";

export function loadSoundEnabled(): boolean {
  try {
    const stored = localStorage.getItem(SOUND_STORAGE_KEY);
    return stored === null ? true : stored === "on";
  } catch {
    return true;
  }
}

export function persistSoundEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(SOUND_STORAGE_KEY, enabled ? "on" : "off");
  } catch {
    // Best-effort -- a private window or blocked site data just means the
    // choice doesn't survive a reload, not a broken app.
  }
}
