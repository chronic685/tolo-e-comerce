import { useState } from "react";
import { ImageOff } from "lucide-react";
import { cn } from "../lib/cn";
import { buildResponsiveSrcSet } from "../lib/responsiveImage";

export interface LazyImageProps {
  src: string | null | undefined;
  alt: string;
  className?: string;
  /** Tailwind aspect-ratio class, e.g. "aspect-square" (default) or "aspect-[4/3]". */
  aspect?: string;
  /** How much of the viewport width this image actually occupies, as a CSS
   * `sizes` value -- lets the browser pick the smallest adequate srcset
   * candidate instead of always grabbing the largest. Defaults to a
   * grid-card-ish size; pass a wider value for e.g. a full-bleed hero. */
  sizes?: string;
}

/** Fixed-aspect-ratio image with lazy loading and a real placeholder (not a
 * blank grey box) for missing or not-yet-loaded images — used anywhere a
 * product/shop photo is shown so the layout never jumps while loading.
 * Also serves a `srcset` of Supabase Storage-resized variants (see
 * lib/responsiveImage.ts) when the source supports it, so a phone on a grid
 * of 160px cards isn't downloading the same multi-megabyte original a
 * full-width hero would use. */
export function LazyImage({ src, alt, className, aspect = "aspect-square", sizes = "(min-width: 768px) 25vw, 50vw" }: LazyImageProps) {
  const [loaded, setLoaded] = useState(false);
  const srcSet = src ? buildResponsiveSrcSet(src) : null;

  return (
    <div className={cn(aspect, "relative bg-gray-100 dark:bg-white/5 overflow-hidden", className)}>
      {(!src || !loaded) && (
        <div className="absolute inset-0 flex items-center justify-center text-gray-300 dark:text-white/15">
          <ImageOff className="w-1/4 h-1/4 min-w-6 min-h-6" />
        </div>
      )}
      {src && (
        <img
          src={src}
          srcSet={srcSet ?? undefined}
          sizes={srcSet ? sizes : undefined}
          alt={alt}
          loading="lazy"
          decoding="async"
          onLoad={() => setLoaded(true)}
          className={cn("w-full h-full object-cover transition-opacity duration-200", loaded ? "opacity-100" : "opacity-0")}
        />
      )}
    </div>
  );
}
