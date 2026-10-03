import { useId, useState } from "react";
import { useTranslation } from "../i18n/useTranslation";
import { cn } from "../lib/cn";

export interface TrendChartPoint {
  label: string;
  value: number;
}

export interface TrendChartProps {
  data: TrendChartPoint[];
  /** Describes what's plotted for screen readers -- a single-series chart
   * carries its identity in the title, not a legend (see dataviz skill). */
  ariaLabel: string;
  formatValue?: (value: number) => string;
  className?: string;
  height?: number;
  /** Shown instead of the chart when there is nothing to plot. */
  emptyMessage?: string;
}

const BAR_MAX_WIDTH = 24;
const BAR_GAP = 2;

/** A single-series bar chart: <=24px bars, 4px rounded tops squared at the
 * baseline, a 2px surface gap between bars, hairline recessive gridlines,
 * and a hover/focus tooltip -- see the dataviz skill's mark spec. One hue
 * (the brand navy) since this is a magnitude series, not a categorical
 * comparison, so no legend is drawn; the chart's caption/title carries
 * identity instead. A visually-hidden table beneath the SVG gives screen
 * reader users and anyone who wants exact values a non-visual alternative. */
export function TrendChart({ data, ariaLabel, formatValue = (v) => String(v), className, height = 160, emptyMessage }: TrendChartProps) {
  const { t } = useTranslation();
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const titleId = useId();

  const max = Math.max(1, ...data.map((d) => d.value));
  const width = Math.max(data.length * (BAR_MAX_WIDTH + BAR_GAP), 240);
  const barWidth = Math.min(BAR_MAX_WIDTH, width / data.length - BAR_GAP);
  const chartHeight = height - 24; // leaves room for the x-axis label row
  const active = activeIndex != null ? data[activeIndex] : null;

  // Nothing to plot (no points, or every point is 0): a row of 1px stubs and
  // gridlines with no axis reads as a rendering glitch, so say so instead.
  if (data.every((d) => d.value === 0)) {
    return (
      <div role="status" className={cn("flex items-center justify-center text-center text-sm text-gray-400 dark:text-gray-500 px-4", className)} style={{ height }}>
        {emptyMessage ?? t("trendChart.noData")}
      </div>
    );
  }

  return (
    <div className={cn("relative", className)}>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby={titleId} className="w-full h-auto" style={{ height }}>
        <title id={titleId}>{ariaLabel}</title>
        {/* Gridlines: 0%, 50%, 100% of the max -- hairline, recessive. */}
        {[0, 0.5, 1].map((fraction) => (
          <line
            key={fraction}
            x1={0}
            x2={width}
            y1={chartHeight - chartHeight * fraction}
            y2={chartHeight - chartHeight * fraction}
            className="stroke-gray-200 dark:stroke-white/10"
            strokeWidth={1}
          />
        ))}

        {data.map((point, i) => {
          const barHeight = Math.max(1, (point.value / max) * chartHeight);
          const x = i * (barWidth + BAR_GAP) + BAR_GAP / 2;
          const y = chartHeight - barHeight;
          const isActive = activeIndex === i;
          return (
            <g key={point.label}>
              {/* Invisible full-height hit target -- bigger than the visible
                  bar so a short/zero-value bar is still easy to hover/tap,
                  per the dataviz skill's "hit targets bigger than the mark". */}
              <rect
                x={x - BAR_GAP / 2}
                y={0}
                width={barWidth + BAR_GAP}
                height={chartHeight}
                fill="transparent"
                tabIndex={0}
                role="button"
                aria-label={`${point.label}: ${formatValue(point.value)}`}
                onMouseEnter={() => setActiveIndex(i)}
                onMouseLeave={() => setActiveIndex(null)}
                onFocus={() => setActiveIndex(i)}
                onBlur={() => setActiveIndex(null)}
                className="outline-none focus-visible:ring-2 focus-visible:ring-navy-light"
              />
              <rect
                x={x}
                y={y}
                width={barWidth}
                height={barHeight}
                rx={4}
                className={cn("fill-navy dark:fill-navy-light transition-opacity", isActive ? "opacity-100" : "opacity-90")}
              />
            </g>
          );
        })}
      </svg>

      {/* x-axis labels -- only first, middle, last to avoid crowding a
          30/90-day window; the table below carries every value. */}
      <div className="flex justify-between text-[10px] text-gray-400 dark:text-gray-500 px-0.5 mt-0.5">
        <span>{data[0]?.label}</span>
        {data.length > 2 && <span>{data[Math.floor(data.length / 2)]?.label}</span>}
        <span>{data[data.length - 1]?.label}</span>
      </div>

      {active && (
        <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-full bg-navy-dark text-white text-xs rounded px-2 py-1 pointer-events-none shadow-popover whitespace-nowrap">
          <span className="font-medium">{active.label}</span>: {formatValue(active.value)}
        </div>
      )}

      <table className="sr-only">
        <caption>{ariaLabel}</caption>
        <tbody>
          {data.map((point) => (
            <tr key={point.label}>
              <th scope="row">{point.label}</th>
              <td>{formatValue(point.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
