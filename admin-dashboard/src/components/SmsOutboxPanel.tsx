import { useEffect, useState } from "react";
import { formatDateTime, useTranslation } from "@tolo/ui";
import { supabase } from "../lib/supabase";

// Read-only view of the latest SMS the platform tried to send (sms_outbox,
// migration 0078). Mostly useful while SMS runs on the mock provider, where
// nothing is actually sent and this log is the only way to see what would have
// gone out; afterwards it doubles as a "did the customer get the text?" aid.
// Login codes are stored as "[redacted]" by the backend, so they never show here.

interface SmsRow {
  id: string;
  phone: string;
  body: string;
  provider: string;
  status: "sent" | "failed" | "mock";
  error: string | null;
  event_type: string | null;
  created_at: string;
}

const STATUS_STYLE: Record<SmsRow["status"], string> = {
  sent: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
  failed: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  mock: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
};

const STATUS_LABEL_KEY: Record<SmsRow["status"], string> = {
  sent: "smsOutbox.status.sent",
  failed: "smsOutbox.status.failed",
  mock: "smsOutbox.status.mock",
};

export function SmsOutboxPanel() {
  const { t } = useTranslation();
  const [rows, setRows] = useState<SmsRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    supabase
      .from("sms_outbox")
      .select("id, phone, body, provider, status, error, event_type, created_at")
      .order("created_at", { ascending: false })
      .limit(20)
      .then(({ data, error }) => {
        if (cancelled) return;
        setFailed(Boolean(error));
        setRows((data as SmsRow[] | null) ?? []);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  return (
    <section className="bg-white dark:bg-navy-dark border rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="font-medium">{t("smsOutbox.title")}</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{t("smsOutbox.description")}</p>
        </div>
        <button onClick={() => setRefreshKey((key) => key + 1)} className="text-xs border px-3 py-1.5 rounded-md hover:bg-gray-50 dark:hover:bg-white/10">
          {t("smsOutbox.refresh")}
        </button>
      </div>

      {rows === null ? (
        <p className="text-sm text-gray-500">{t("smsOutbox.loading")}</p>
      ) : failed ? (
        <p className="text-sm text-red-600 dark:text-red-400">{t("smsOutbox.loadError")}</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">{t("smsOutbox.empty")}</p>
      ) : (
        <ul className="divide-y dark:divide-white/10">
          {rows.map((row) => (
            <li key={row.id} className="py-2 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{row.phone}</span>
                <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_STYLE[row.status]}`}>{t(STATUS_LABEL_KEY[row.status])}</span>
              </div>
              <p className="text-gray-700 dark:text-gray-300">{row.body}</p>
              <p className="text-xs text-gray-400 dark:text-gray-500">
                {formatDateTime(row.created_at)}
                {row.event_type ? ` · ${row.event_type.replace(/_/g, " ")}` : ""} · {row.provider}
                {row.error ? ` · ${row.error}` : ""}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
