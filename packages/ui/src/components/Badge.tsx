import type { HTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/cn";

const badgeVariants = cva("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium", {
  variants: {
    variant: {
      default: "bg-gray-100 text-gray-700 dark:bg-white/10 dark:text-gray-300",
      navy: "bg-navy text-white dark:bg-navy-light",
      "navy-subtle": "bg-navy-50 text-navy dark:bg-navy-light/20 dark:text-navy-light",
      success: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
      warning: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300",
      danger: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
      info: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
    },
  },
  defaultVariants: { variant: "default" },
});

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
