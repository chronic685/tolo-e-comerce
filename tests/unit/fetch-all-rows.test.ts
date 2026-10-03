import { describe, expect, it } from "vitest";
import { fetchAllRows, fetchAllRowsForIds } from "../../packages/ui/src/lib/fetchAllRows";

// PR #6 review fix: every admin CSV export used to do a single
// `.range(0, 4999)` fetch, but Supabase/PostgREST caps every response at
// `api.max_rows` (1000, supabase/config.toml) regardless of the range
// requested -- so anything past the first 1000 rows was silently dropped
// from the exported file. fetchAllRows() walks the query in max_rows-sized
// pages instead. This is a pure-logic test against a fake paginated query
// (no database involved), matching csv-parser.test.ts's style for this
// suite's other pure-logic coverage.
function fakeTable(totalRows: number) {
  const rows = Array.from({ length: totalRows }, (_, i) => ({ id: i }));
  let calls = 0;
  const fetchPage = (from: number, to: number) => {
    calls++;
    return Promise.resolve({ data: rows.slice(from, to + 1), error: null });
  };
  return { fetchPage, callCount: () => calls };
}

describe("fetchAllRows", () => {
  it("returns every row when the whole set fits in one page", async () => {
    const table = fakeTable(3);
    const rows = await fetchAllRows(table.fetchPage, 1000);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.id)).toEqual([0, 1, 2]);
    expect(table.callCount()).toBe(1);
  });

  it("walks multiple pages past Supabase's 1000-row cap", async () => {
    const table = fakeTable(2500);
    const rows = await fetchAllRows(table.fetchPage, 1000);
    expect(rows).toHaveLength(2500);
    expect(rows[0].id).toBe(0);
    expect(rows[2499].id).toBe(2499);
    // 1000 + 1000 + 500, then stops -- no extra request once a short page proves nothing's left.
    expect(table.callCount()).toBe(3);
  });

  it("resolves an exact-multiple page count with one harmless extra empty request", async () => {
    // A page exactly pageSize long is ambiguous (could be the last page,
    // or exactly full) -- this resolves it by always requesting the next
    // page too when the previous one was full-length, at the cost of one
    // extra empty request in this exact-multiple case. Assert the result
    // is still correct, not that the extra request is skipped.
    const table = fakeTable(2000);
    const rows = await fetchAllRows(table.fetchPage, 1000);
    expect(rows).toHaveLength(2000);
    expect(table.callCount()).toBe(3);
  });

  it("propagates a page's error instead of returning a partial result silently", async () => {
    let calls = 0;
    const fetchPage = (from: number, to: number) => {
      calls++;
      if (calls === 2) return Promise.resolve({ data: null, error: { message: "boom" } });
      return Promise.resolve({ data: Array.from({ length: 1000 }, (_, i) => ({ id: from + i })), error: null });
    };
    await expect(fetchAllRows(fetchPage, 1000)).rejects.toThrow("boom");
  });

  it("defaults to Supabase's own 1000-row max_rows page size", async () => {
    const table = fakeTable(1500);
    const rows = await fetchAllRows(table.fetchPage);
    expect(rows).toHaveLength(1500);
    expect(table.callCount()).toBe(2);
  });
});

describe("fetchAllRowsForIds", () => {
  // A table of `perId` rows for every id, as `.in("owner", chunk)` would return them.
  function fakeOwnedRows(perId: number) {
    const idsSeen: number[] = [];
    const fetchPage = (chunk: string[], from: number, to: number) => {
      idsSeen.push(chunk.length);
      const all = chunk.flatMap((owner) => Array.from({ length: perId }, (_, i) => ({ owner, i })));
      return Promise.resolve({ data: all.slice(from, to + 1), error: null });
    };
    return { fetchPage, idsSeen };
  }

  it("never puts more than a chunk of ids in one request, however many are asked for", async () => {
    const ids = Array.from({ length: 1050 }, (_, i) => `id-${i}`);
    const t = fakeOwnedRows(1);
    const rows = await fetchAllRowsForIds(ids, t.fetchPage);
    expect(rows).toHaveLength(1050);
    expect(Math.max(...t.idsSeen)).toBeLessThanOrEqual(100);
  });

  it("pages within a chunk, so one chunk's rows past 1000 are not dropped", async () => {
    const ids = Array.from({ length: 100 }, (_, i) => `id-${i}`);
    const rows = await fetchAllRowsForIds(ids, fakeOwnedRows(25).fetchPage);
    expect(rows).toHaveLength(2500);
  });

  it("makes no request for an empty id list", async () => {
    const t = fakeOwnedRows(1);
    expect(await fetchAllRowsForIds([], t.fetchPage)).toEqual([]);
    expect(t.idsSeen).toEqual([]);
  });

  it("propagates an error instead of returning a partial result", async () => {
    await expect(fetchAllRowsForIds(["a"], () => Promise.resolve({ data: null, error: { message: "boom" } }))).rejects.toThrow("boom");
  });
});
