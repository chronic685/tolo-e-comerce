import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "./Button";
import { cn } from "../lib/cn";
import { useTranslation } from "../i18n/useTranslation";

export interface PaginationProps {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  className?: string;
}

// Always includes page 1, the last page, and up to one neighbor on each
// side of the current page, collapsing any gap into a single ellipsis --
// e.g. for page 5 of 20: 1 … 4 5 6 … 20.
function pageNumbers(page: number, totalPages: number): (number | "ellipsis")[] {
  const keep = new Set<number>([1, totalPages, page - 1, page, page + 1]);
  const sorted = [...keep].filter((p) => p >= 1 && p <= totalPages).sort((a, b) => a - b);

  const result: (number | "ellipsis")[] = [];
  let previous = 0;
  for (const p of sorted) {
    if (previous && p - previous > 1) result.push("ellipsis");
    result.push(p);
    previous = p;
  }
  return result;
}

export function Pagination({ page, totalPages, onPageChange, className }: PaginationProps) {
  const { t } = useTranslation();
  if (totalPages <= 1) return null;

  return (
    <nav aria-label={t("pagination.label")} className={cn("flex items-center justify-center gap-1", className)}>
      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-label={t("pagination.previousPage")}
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
        className="h-8 w-8"
      >
        <ChevronLeft className="w-4 h-4" />
      </Button>

      {pageNumbers(page, totalPages).map((p, i) =>
        p === "ellipsis" ? (
          <span
            key={`ellipsis-${i}`}
            className="hidden sm:inline-flex items-center justify-center h-8 w-8 text-sm text-gray-400 dark:text-gray-600"
            aria-hidden="true"
          >
            …
          </span>
        ) : (
          <Button
            key={p}
            type="button"
            variant={p === page ? "default" : "outline"}
            size="icon"
            aria-label={t("pagination.goToPage", { page: p })}
            aria-current={p === page ? "page" : undefined}
            onClick={() => onPageChange(p)}
            className="hidden sm:inline-flex h-8 w-8 text-sm"
          >
            {p}
          </Button>
        ),
      )}

      <span className="sm:hidden text-sm text-gray-500 dark:text-gray-400 px-2" aria-live="polite">
        {t("pagination.pageOf", { page, total: totalPages })}
      </span>

      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-label={t("pagination.nextPage")}
        disabled={page >= totalPages}
        onClick={() => onPageChange(page + 1)}
        className="h-8 w-8"
      >
        <ChevronRight className="w-4 h-4" />
      </Button>
    </nav>
  );
}
