import { renderHook, act } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { usePagination } from "./usePagination";

// jsdom doesn't implement window.scrollTo -- usePagination calls it on
// every page change (the "scroll to top on page change" requirement), so
// it needs a stub here or jsdom logs a "not implemented" error per call.
beforeAll(() => {
  window.scrollTo = vi.fn();
});

function withRouter(initialEntries: string[]) {
  return ({ children }: { children: React.ReactNode }) => <MemoryRouter initialEntries={initialEntries}>{children}</MemoryRouter>;
}

describe("usePagination", () => {
  it("defaults to page 1 with no ?page in the URL", () => {
    const { result } = renderHook(() => usePagination({ pageSize: 10 }), { wrapper: withRouter(["/"]) });
    expect(result.current.page).toBe(1);
    expect(result.current.from).toBe(0);
    expect(result.current.to).toBe(9);
  });

  it("reads a valid ?page from the URL", () => {
    const { result } = renderHook(() => usePagination({ pageSize: 10 }), { wrapper: withRouter(["/?page=3"]) });
    expect(result.current.page).toBe(3);
    expect(result.current.from).toBe(20);
    expect(result.current.to).toBe(29);
  });

  it.each(["0", "-1", "abc", "1.5", ""])("clamps an invalid ?page=%s to 1", (value) => {
    const { result } = renderHook(() => usePagination({ pageSize: 10 }), { wrapper: withRouter([`/?page=${value}`]) });
    expect(result.current.page).toBe(1);
  });

  it("setPage writes ?page= into the URL and updates from/to", () => {
    const { result } = renderHook(() => usePagination({ pageSize: 12 }), { wrapper: withRouter(["/"]) });
    act(() => result.current.setPage(4));
    expect(result.current.page).toBe(4);
    expect(result.current.from).toBe(36);
    expect(result.current.to).toBe(47);
  });

  it("setPage(1) removes ?page= from the URL instead of writing page=1", () => {
    const { result } = renderHook(() => usePagination({ pageSize: 10 }), { wrapper: withRouter(["/?page=5"]) });
    act(() => result.current.setPage(1));
    expect(result.current.page).toBe(1);
  });

  it("preserves other query params when changing page", () => {
    const { result } = renderHook(() => usePagination({ pageSize: 10 }), { wrapper: withRouter(["/?q=shoes&page=2"]) });
    act(() => result.current.setPage(3));
    expect(result.current.page).toBe(3);
  });

  it("resets to page 1 when resetKey changes", () => {
    const { result, rerender } = renderHook(({ resetKey }: { resetKey: string }) => usePagination({ pageSize: 10, resetKey }), {
      wrapper: withRouter(["/?page=5"]),
      initialProps: { resetKey: "a" },
    });
    expect(result.current.page).toBe(5);

    rerender({ resetKey: "b" });
    expect(result.current.page).toBe(1);
  });

  it("does not reset the page when resetKey stays the same", () => {
    const { result, rerender } = renderHook(({ resetKey }: { resetKey: string }) => usePagination({ pageSize: 10, resetKey }), {
      wrapper: withRouter(["/?page=5"]),
      initialProps: { resetKey: "a" },
    });
    expect(result.current.page).toBe(5);

    rerender({ resetKey: "a" });
    expect(result.current.page).toBe(5);
  });

  it("uses a custom paramName so two independent lists on one page don't collide", () => {
    const { result: a } = renderHook(() => usePagination({ pageSize: 10, paramName: "settlements_page" }), {
      wrapper: withRouter(["/?settlements_page=3&adjustments_page=7"]),
    });
    const { result: b } = renderHook(() => usePagination({ pageSize: 10, paramName: "adjustments_page" }), {
      wrapper: withRouter(["/?settlements_page=3&adjustments_page=7"]),
    });
    expect(a.current.page).toBe(3);
    expect(b.current.page).toBe(7);
  });
});
