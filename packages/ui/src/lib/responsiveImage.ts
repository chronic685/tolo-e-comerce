// Item 7 (Advanced UI pass): "image lazy-loading and optimized sizes."
// Supabase Storage serves a resized/re-encoded variant of any public object
// through its image transformation endpoint -- swapping
// `/storage/v1/object/public/...` for `/storage/v1/render/image/public/...`
// and adding `?width=`/`quality=` -- so a product photo uploaded once at
// full resolution can still be served at roughly the pixel size it's
// actually displayed at, instead of shipping the same multi-megabyte
// original to every card, thumbnail, and full-size detail view alike.
const OBJECT_PUBLIC_MARKER = "/storage/v1/object/public/";
const RENDER_PUBLIC_MARKER = "/storage/v1/render/image/public/";

/** Widths this app renders a product/shop photo at, smallest to largest --
 * shared by every LazyImage srcset so the CDN only ever has to cache this
 * fixed set of variants rather than one per arbitrary layout width. */
export const RESPONSIVE_IMAGE_WIDTHS = [160, 320, 640, 960] as const;

/** Returns null for anything that isn't a resizable Supabase Storage public
 * URL (a third-party/seed image, a relative path, etc.) -- callers fall
 * back to the original `src` unchanged in that case. */
export function buildResponsiveImageUrl(src: string, width: number, quality = 70): string | null {
  if (!src.includes(OBJECT_PUBLIC_MARKER)) return null;
  const base = src.replace(OBJECT_PUBLIC_MARKER, RENDER_PUBLIC_MARKER);
  const separator = base.includes("?") ? "&" : "?";
  return `${base}${separator}width=${width}&quality=${quality}`;
}

/** Builds a full `srcset` string across RESPONSIVE_IMAGE_WIDTHS, or null if
 * `src` isn't a resizable Supabase Storage URL. */
export function buildResponsiveSrcSet(src: string, widths: readonly number[] = RESPONSIVE_IMAGE_WIDTHS): string | null {
  const entries = widths
    .map((w) => {
      const url = buildResponsiveImageUrl(src, w);
      return url ? `${url} ${w}w` : null;
    })
    .filter((entry): entry is string => entry !== null);
  return entries.length > 0 ? entries.join(", ") : null;
}
