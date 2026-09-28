import { Check } from "lucide-react";
import { cn } from "../lib/cn";

export interface StepperStep {
  key: string;
  label: string;
  /** Optional timestamp/subtext shown under the label once reached. */
  detail?: string;
}

export interface StepperProps {
  steps: StepperStep[];
  /** Index of the current/furthest-reached step. Steps before it are done,
   * this one is active, steps after are pending. */
  currentIndex: number;
  className?: string;
}

/** Horizontal linear progress tracker (placed → accepted → ... → delivered
 * style). For terminal/branch states that aren't a point on the happy path
 * (cancelled, rejected), render a Badge instead of this component. */
export function Stepper({ steps, currentIndex, className }: StepperProps) {
  return (
    <div className={cn("flex", className)}>
      {steps.map((step, i) => {
        const done = i < currentIndex;
        const active = i === currentIndex;
        const isLast = i === steps.length - 1;
        return (
          <div key={step.key} className={cn("flex items-start", isLast ? "flex-none" : "flex-1")}>
            <div className="flex flex-col items-center flex-shrink-0">
              <div
                className={cn(
                  "w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium flex-shrink-0",
                  done && "bg-navy text-white",
                  active && "bg-navy text-white ring-4 ring-navy-50",
                  !done && !active && "bg-gray-200 text-gray-500",
                )}
              >
                {done ? <Check className="w-3.5 h-3.5" /> : i + 1}
              </div>
              <p className={cn("mt-1.5 text-[11px] text-center leading-tight max-w-[64px]", active ? "font-semibold text-navy" : "text-gray-500")}>
                {step.label}
              </p>
              {step.detail && active && <p className="text-[10px] text-gray-400 text-center max-w-[72px]">{step.detail}</p>}
            </div>
            {!isLast && (
              <div className={cn("h-0.5 flex-1 mt-3 mx-1", i < currentIndex ? "bg-navy" : "bg-gray-200")} />
            )}
          </div>
        );
      })}
    </div>
  );
}
