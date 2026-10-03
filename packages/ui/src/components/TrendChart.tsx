import { useEffect, useId, useRef, useState } from "react";
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
const FALLBACK_WIDTH = 320; // before the first measurement, and where layout isn't available (jsdom)
const LABEL_ROW_HEIGHT = 24;
const EMPTY_HEIGHT = 80;

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
  const containerRef = useRef<HTMLDivElement>(null);
  const [measuredWidth, setMeasuredWidth] = useState(0);
  const isEmpty = data.every((d) => d.value === 0);

  // The SVG is drawn at the container's real pixel width (viewBox == rendered
  // size), so nothing is ever scaled: bars keep their proportions and rounded
  // corners, and the chart spans the card at every viewport width and date range.
  // (preserveAspectRatio="none" would stretch the 4px corner radii.)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => setMeasuredWidth(Math.round(el.getBoundingClientRect().width));
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [isEmpty]);

  const max = Math.max(1, ...data.map((d) => d.value));
  const width = measuredWidth > 0 ? measuredWidth : FALLBACK_WIDTH;
  const slot = width / data.length; // each point's share of the width
  const barWidth = Math.max(1, Math.min(BAR_MAX_WIDTH, slot - BAR_GAP));
  const chartHeight = height - LABEL_ROW_HEIGHT; // the x-axis label row sits below the svg, not inside it
  const active = activeIndex != null ? data[activeIndex] : null;

  // Nothing to plot (no points, or every point is 0): a row of 1px stubs and
  // gridlines with no axis reads as a rendering glitch, so say so instead.
  if (isEmpty) {
    return (
      <div role="status" className={cn("flex items-center justify-center text-center text-sm text-gray-400 dark:text-gray-500 px-4", className)} style={{ height: EMPTY_HEIGHT }}>
        {emptyMessage ?? t("trendChart.noData")}
      </div>
    );
  }

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <svg viewBox={`0 0 ${width} ${chartHeight}`} width={width} height={chartHeight} role="img" aria-labelledby={titleId} className="block max-w-full">
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
          const x = i * slot + (slot - barWidth) / 2; // bar centred in its slot
          const y = chartHeight - barHeight;
          const isActive = activeIndex === i;
          return (
            <g key={point.label}>
              {/* Invisible full-height hit target -- bigger than the visible
                  bar so a short/zero-value bar is still easy to hover/tap,
                  per the dataviz skill's "hit targets bigger than the mark". */}
              <rect
                x={i * slot}
                y={0}
                width={slot}
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
