import { useTranslation } from "../i18n/useTranslation";
import { cn } from "../lib/cn";
import { fromDateInputValue, lastNDays, toDateInputValue, type DateRange } from "../lib/dateRange";

const PRESETS = [7, 30, 90] as const;

export interface DateRangePickerProps {
  range: DateRange;
  onChange: (range: DateRange) => void;
  className?: string;
}

/** Preset day-count buttons (matching the 7/30/90-day pattern already used
 * by merchant-dashboard's RevenueChart) plus two native date inputs for a
 * genuinely custom range -- native inputs so this gets a real OS/browser
 * date picker (keyboard-operable, localized) for free instead of a
 * hand-rolled calendar widget. */
export function DateRangePicker({ range, onChange, className }: DateRangePickerProps) {
  const { t } = useTranslation();

  const activePreset = PRESETS.find((days) => {
    const preset = lastNDays(days);
    return toDateInputValue(preset.start) === toDateInputValue(range.start) && toDateInputValue(preset.end) === toDateInputValue(range.end);
  });

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <span className="text-xs text-gray-500 dark:text-gray-400">{t("merchantDashboard.dateRange")}</span>
      <div className="flex gap-1">
        {PRESETS.map((days) => (
          <button
            key={days}
            type="button"
            onClick={() => onChange(lastNDays(days))}
            aria-pressed={activePreset === days}
            className={cn(
              "px-2.5 py-1 rounded-md text-xs font-medium border",
              activePreset === days
                ? "bg-navy text-white border-navy dark:bg-navy-light dark:border-navy-light"
                : "bg-white text-gray-600 border-gray-200 dark:bg-navy-dark dark:text-gray-300 dark:border-white/20",
            )}
          >
            {days}d
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1.5">
        <input
          type="date"
          value={toDateInputValue(range.start)}
          max={toDateInputValue(range.end)}
          aria-label={t("merchantDashboard.customRange")}
          onChange={(e) => {
            const start = fromDateInputValue(e.target.value);
            if (start) onChange({ start, end: range.end });
          }}
          className="border rounded-md px-2 py-1 text-xs dark:bg-navy-dark dark:border-white/20 dark:text-gray-100"
        />
        <span className="text-gray-400 text-xs" aria-hidden="true">
          –
        </span>
        <input
          type="date"
          value={toDateInputValue(range.end)}
          min={toDateInputValue(range.start)}
          aria-label={t("merchantDashboard.customRange")}
          onChange={(e) => {
            const end = fromDateInputValue(e.target.value);
            if (end) onChange({ start: range.start, end });
          }}
          className="border rounded-md px-2 py-1 text-xs dark:bg-navy-dark dark:border-white/20 dark:text-gray-100"
        />
      </div>
    </div>
  );
}
