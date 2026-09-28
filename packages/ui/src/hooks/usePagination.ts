import { useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { rangeFor } from "../lib/pagination";

export interface UsePaginationOptions {
  pageSize: number;
  // Whenever this value changes (compared with !==), the page resets to 1 --
  // pass a value that changes whenever the current search/filter/sort does,
  // so a query change never leaves the user stranded on a page number the
  // new results don't have.
  resetKey?: unknown;
  // The URL query param to read/write. Defaults to "page" -- only needs
  // overriding when a single page has more than one independent paginated
  // list (e.g. "adjustments_page"), so each gets its own param instead of
  // colliding on the same "page" key.
  paramName?: string;
}

export interface UsePaginationResult {
  page: number;
  pageSize: number;
  from: number;
  to: number;
  setPage: (page: number) => void;
}

export function usePagination({ pageSize, resetKey, paramName = "page" }: UsePaginationOptions): UsePaginationResult {
  const [searchParams, setSearchParams] = useSearchParams();

  const rawPage = searchParams.get(paramName);
  const parsedPage = rawPage === null ? 1 : Number.parseInt(rawPage, 10);
  const page = Number.isFinite(parsedPage) && parsedPage >= 1 ? Math.floor(parsedPage) : 1;

  function setPage(next: number) {
    const clamped = Number.isFinite(next) && next >= 1 ? Math.floor(next) : 1;
    const params = new URLSearchParams(searchParams);
    if (clamped <= 1) params.delete(paramName);
    else params.set(paramName, String(clamped));
    setSearchParams(params, { replace: true });
    if (typeof window !== "undefined") window.scrollTo({ top: 0 });
  }

  const resetKeyRef = useRef(resetKey);
  useEffect(() => {
    if (resetKeyRef.current !== resetKey) {
      resetKeyRef.current = resetKey;
      if (page !== 1) setPage(1);
    }
    // Only the resetKey changing should trigger this -- page/setPage
    // deliberately excluded, or a filter change and a page change would
    // fight each other on the same render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  const [from, to] = rangeFor(page, pageSize);
  return { page, pageSize, from, to, setPage };
}
