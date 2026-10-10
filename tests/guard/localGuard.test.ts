import { describe, expect, it } from "vitest";
import { assertLocalSupabaseUrl, isLocalSupabaseUrl } from "../localGuard.ts";

describe("test environment guard", () => {
  it.each(["http://127.0.0.1:54321", "http://localhost:54321", "http://localhost", "https://127.0.0.1:54321/", "http://[::1]:54321"])(
    "allows the local URL %s",
    (url) => {
      expect(isLocalSupabaseUrl(url)).toBe(true);
      expect(assertLocalSupabaseUrl(url)).toBe(url);
    },
  );

  it.each([
    "https://abcdefghij.supabase.co",
    "https://abcdefghij.supabase.co/rest/v1",
    "http://127.0.0.1.evil.example",
    "http://localhost.example.com",
    "http://user@evil.example#@localhost",
    "https://db.example.com:54321",
    "not a url",
    "",
    "ftp://localhost",
  ])("refuses %s before anything is touched", (url) => {
    expect(isLocalSupabaseUrl(url)).toBe(false);
    expect(() => assertLocalSupabaseUrl(url)).toThrow(/Refusing to run the backend tests against a non-local Supabase/);
  });

  it("the refusal tells the developer how to fix it", () => {
    expect(() => assertLocalSupabaseUrl("https://x.supabase.co")).toThrow(/npx supabase start/);
  });
});
