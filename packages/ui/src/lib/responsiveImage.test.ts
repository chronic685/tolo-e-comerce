import { describe, expect, it } from "vitest";
import { buildResponsiveImageUrl, buildResponsiveSrcSet } from "./responsiveImage";

const PUBLIC_URL = "https://project.supabase.co/storage/v1/object/public/product-photos/abc.jpg";

describe("buildResponsiveImageUrl", () => {
  it("rewrites a Supabase Storage public object URL to the render/image endpoint with width+quality", () => {
    expect(buildResponsiveImageUrl(PUBLIC_URL, 320)).toBe(
      "https://project.supabase.co/storage/v1/render/image/public/product-photos/abc.jpg?width=320&quality=70",
    );
  });

  it("appends with & when the source URL already has a query string", () => {
    expect(buildResponsiveImageUrl(`${PUBLIC_URL}?v=2`, 320)).toBe(
      "https://project.supabase.co/storage/v1/render/image/public/product-photos/abc.jpg?v=2&width=320&quality=70",
    );
  });

  it("returns null for a non-Supabase-Storage URL", () => {
    expect(buildResponsiveImageUrl("https://cdn.example.com/photo.jpg", 320)).toBeNull();
  });
});

describe("buildResponsiveSrcSet", () => {
  it("builds a comma-separated srcset across the given widths", () => {
    expect(buildResponsiveSrcSet(PUBLIC_URL, [160, 320])).toBe(
      "https://project.supabase.co/storage/v1/render/image/public/product-photos/abc.jpg?width=160&quality=70 160w, " +
        "https://project.supabase.co/storage/v1/render/image/public/product-photos/abc.jpg?width=320&quality=70 320w",
    );
  });

  it("returns null when the URL can't be resized", () => {
    expect(buildResponsiveSrcSet("https://cdn.example.com/photo.jpg")).toBeNull();
  });
});
