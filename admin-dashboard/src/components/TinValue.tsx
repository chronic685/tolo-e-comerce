import { Copy } from "lucide-react";
import { toast, useTranslation } from "@tolo/ui";

/** A TIN as shown to admins: the number, a copy button, and the reminder that nothing checked it. The
 * applicant typed it and the system never verified it against the tax authority, so an admin has to. */
export function TinValue({ tin, showCaption = true }: { tin: string | null | undefined; showCaption?: boolean }) {
  const { t } = useTranslation();

  async function copy() {
    if (!tin) return;
    try {
      await navigator.clipboard.writeText(tin);
      toast.success(t("tin.copied"));
    } catch {
      toast.error(t("tin.copyFailed"));
    }
  }

  if (!tin) return <span className="text-gray-400 dark:text-gray-500">—</span>;

  return (
    <div>
      <div className="flex items-center gap-1.5">
        <span className="font-mono text-sm tracking-wide dark:text-gray-100">{tin}</span>
        <button
          type="button"
          onClick={copy}
          title={t("tin.copy")}
          aria-label={t("tin.copy")}
          className="p-1 rounded text-gray-500 hover:text-navy hover:bg-gray-100 dark:text-gray-400 dark:hover:text-white dark:hover:bg-white/10"
        >
          <Copy className="w-3.5 h-3.5" />
        </button>
      </div>
      {showCaption && <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">{t("tin.verifyManually")}</p>}
    </div>
  );
}
