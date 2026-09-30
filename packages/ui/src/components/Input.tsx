import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "../lib/cn";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "w-full border rounded-md px-3 py-2 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-navy-light disabled:opacity-50 dark:bg-navy-dark dark:border-white/20 dark:text-gray-100 dark:placeholder:text-gray-500",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";
