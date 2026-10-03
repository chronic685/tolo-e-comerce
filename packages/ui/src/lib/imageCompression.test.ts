import { describe, expect, it, vi } from "vitest";
import {
  compressImage,
  fitWithin,
  ImageCompressionError,
  LOGO_IMAGE_PRESET,
  PRODUCT_IMAGE_PRESET,
  type ImageCodec,
} from "./imageCompression";

const file = (name: string, type: string, bytes: number) => new File([new Uint8Array(bytes)], name, { type });

/** A codec whose output size depends only on pixel count and quality, so the tests control it. */
function codec(width: number, height: number, bytesPerPixelAtFullQuality = 0.5): ImageCodec & { encode: ReturnType<typeof vi.fn> } {
  return {
    decode: vi.fn(async () => ({ width, height, source: {} })),
    encode: vi.fn(async (_img, w: number, h: number, q: number) => new Blob([new Uint8Array(Math.round(w * h * bytesPerPixelAtFullQuality * q))], { type: "image/webp" })),
  };
}

describe("fitWithin", () => {
  it("scales the longest side down to the limit, keeping the aspect ratio", () => {
    expect(fitWithin(4000, 3000, 1600)).toEqual({ width: 1600, height: 1200 });
    expect(fitWithin(3000, 4000, 1600)).toEqual({ width: 1200, height: 1600 });
  });
  it("never enlarges", () => {
    expect(fitWithin(300, 200, 1600)).toEqual({ width: 300, height: 200 });
    expect(fitWithin(1600, 1600, 1600)).toEqual({ width: 1600, height: 1600 });
  });
  it("never rounds a side to zero", () => {
    expect(fitWithin(10000, 1, 100)).toEqual({ width: 100, height: 1 });
  });
});

describe("compressImage", () => {
  it("leaves an image that is already small enough untouched", async () => {
    const original = file("logo.png", "image/png", 50 * 1024);
    const c = codec(400, 300);
    expect(await compressImage(original, LOGO_IMAGE_PRESET, c)).toBe(original);
    expect(c.encode).not.toHaveBeenCalled();
  });

  it("turns the 1.77 MB, full-size logo from the live project into a WebP within the logo preset", async () => {
    const out = await compressImage(file("ChatGPT Image Jun 30.png", "image/png", 1_766_928), LOGO_IMAGE_PRESET, codec(1536, 1024));
    expect(out.type).toBe("image/webp");
    expect(out.name).toBe("ChatGPT Image Jun 30.webp");
    expect(out.size).toBeLessThanOrEqual(LOGO_IMAGE_PRESET.maxBytes);
  });

  it("scales a large photo to at most 1600 px on its longest side and 300 KB", async () => {
    const c = codec(4000, 3000);
    const out = await compressImage(file("shoe.jpg", "image/jpeg", 4_000_000), PRODUCT_IMAGE_PRESET, c);
    expect(out.size).toBeLessThanOrEqual(PRODUCT_IMAGE_PRESET.maxBytes);
    const [, w, h] = c.encode.mock.calls[0] as [unknown, number, number];
    expect(Math.max(w, h)).toBeLessThanOrEqual(1600);
    expect(w / h).toBeCloseTo(4 / 3, 1);
  });

  it("re-encodes a small-in-bytes but oversize-in-pixels image, and any GIF", async () => {
    const huge = await compressImage(file("big.png", "image/png", 80 * 1024), LOGO_IMAGE_PRESET, codec(3000, 3000, 0.001));
    expect(huge.type).toBe("image/webp");
    const gif = await compressImage(file("a.gif", "image/gif", 10 * 1024), LOGO_IMAGE_PRESET, codec(100, 100, 0.1));
    expect(gif.type).toBe("image/webp");
  });

  it("steps quality down, then size, until it fits", async () => {
    // Incompressible enough that full quality at 1600px is far too big.
    const c = codec(1600, 1600, 1.5);
    const out = await compressImage(file("noise.png", "image/png", 9_000_000), PRODUCT_IMAGE_PRESET, c);
    expect(out.size).toBeLessThanOrEqual(PRODUCT_IMAGE_PRESET.maxBytes);
    const qualities = c.encode.mock.calls.map((call) => call[3] as number);
    expect(qualities[0]).toBeGreaterThan(qualities[1]);
  });

  it("gives up with an ImageCompressionError when it cannot get under the limit", async () => {
    await expect(compressImage(file("x.png", "image/png", 9_000_000), LOGO_IMAGE_PRESET, codec(4000, 4000, 1000))).rejects.toBeInstanceOf(
      ImageCompressionError,
    );
  });

  it("refuses non-images and SVG, and files the browser can't decode", async () => {
    const c = codec(100, 100);
    await expect(compressImage(file("a.pdf", "application/pdf", 10), LOGO_IMAGE_PRESET, c)).rejects.toBeInstanceOf(ImageCompressionError);
    await expect(compressImage(file("a.svg", "image/svg+xml", 10), LOGO_IMAGE_PRESET, c)).rejects.toBeInstanceOf(ImageCompressionError);
    const broken: ImageCodec = { decode: async () => Promise.reject(new Error("bad")), encode: async () => new Blob() };
    await expect(compressImage(file("a.png", "image/png", 10), LOGO_IMAGE_PRESET, broken)).rejects.toBeInstanceOf(ImageCompressionError);
  });
});
