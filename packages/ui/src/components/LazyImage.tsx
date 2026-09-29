import { useState } from "react";
import { ImageOff } from "lucide-react";
import { cn } from "../lib/cn";

export interface LazyImageProps {
  src: string | null | undefined;
  alt: string;
  className?: string;
  /** Tailwind aspect-ratio class, e.g. "aspect-square" (default) or "aspect-[4/3]". */
  aspect?: string;
}

/** Fixed-aspect-ratio image with lazy loading and a real placeholder (not a
 * blank grey box) for missing or not-yet-loaded images — used anywhere a
 * product/shop photo is shown so the layout never jumps while loading. */
export function LazyImage({ src, alt, className, aspect = "aspect-square" }: LazyImageProps) {
  const [loaded, setLoaded] = useState(false);

  return (
    <div className={cn(aspect, "relative bg-gray-100 overflow-hidden", className)}>
      {(!src || !loaded) && (
        <div className="absolute inset-0 flex items-center justify-center text-gray-300">
          <ImageOff className="w-1/4 h-1/4 min-w-6 min-h-6" />
        </div>
      )}
      {src && (
        <img
          src={src}
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
