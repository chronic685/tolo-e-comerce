import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadSoundEnabled, persistSoundEnabled } from "./soundPreference";

describe("sound preference persistence", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it("defaults to enabled when nothing is stored", () => {
    expect(loadSoundEnabled()).toBe(true);
  });

  it("round-trips a disabled choice", () => {
    persistSoundEnabled(false);
    expect(loadSoundEnabled()).toBe(false);
  });

  it("round-trips a re-enabled choice", () => {
    persistSoundEnabled(false);
    persistSoundEnabled(true);
    expect(loadSoundEnabled()).toBe(true);
  });
});
