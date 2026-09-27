import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "../lib/cn";

export interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn("text-center py-16 px-4", className)}>
      {Icon && (
        <div className="mx-auto mb-3 w-12 h-12 rounded-full bg-navy-50 flex items-center justify-center">
          <Icon className="w-6 h-6 text-navy" />
        </div>
      )}
      <p className="font-medium text-gray-700">{title}</p>
      {description && <p className="text-sm text-gray-500 mt-1">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
