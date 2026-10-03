// Shrinks an image in the browser before it is uploaded to Supabase Storage.
//
// Why: on the live project one shop-logo PNG (1.77 MB, a full-size screenshot)
// was 94% of everything in storage, and the product-images bucket allowed 5 MB
// per file. Free-tier storage is 1 GB: at 300 KB per image that is about 3,400
// images, at 1.77 MB about 580. The bucket limit is now 1 MB (migration 0086);
// this is what keeps normal uploads far below it.
//
// Every image is decoded, scaled down to fit `maxDimension` (never up), and
// re-encoded as WebP, lowering quality (then size) until it is within
// `maxBytes`. An image that is already within both limits is left untouched.

export interface ImagePreset {
  /** Longest side, in pixels. */
  maxDimension: number;
  maxBytes: number;
}

/** Shop logos: shown small, often as a circle. */
export const LOGO_IMAGE_PRESET: ImagePreset = { maxDimension: 512, maxBytes: 100 * 1024 };
/** Product photos and banners. */
export const PRODUCT_IMAGE_PRESET: ImagePreset = { maxDimension: 1600, maxBytes: 300 * 1024 };

const QUALITY_STEPS = [0.85, 0.75, 0.65, 0.55, 0.45, 0.35];
const MAX_SHRINK_ROUNDS = 4;
const SHRINK_FACTOR = 0.8;

export class ImageCompressionError extends Error {}

/** The largest size that fits inside `max` x `max`, same aspect ratio, never enlarged. */
export function fitWithin(width: number, height: number, max: number): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= max) return { width, height };
  const scale = max / longest;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export interface DecodedImage {
  width: number;
  height: number;
  /** Opaque handle the encoder understands. */
  source: unknown;
}

export interface ImageCodec {
  decode(file: File): Promise<DecodedImage>;
  encode(image: DecodedImage, width: number, height: number, quality: number): Promise<Blob>;
}

/** The browser's own decoder/encoder (createImageBitmap + canvas WebP). */
export const browserCodec: ImageCodec = {
  async decode(file) {
    const bitmap = await createImageBitmap(file);
    return { width: bitmap.width, height: bitmap.height, source: bitmap };
  },
  async encode(image, width, height, quality) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new ImageCompressionError("No 2D canvas available.");
    ctx.drawImage(image.source as ImageBitmap, 0, 0, width, height);
    return new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new ImageCompressionError("Could not encode image."))), "image/webp", quality);
    });
  },
};

function webpName(name: string): string {
  return `${name.replace(/\.[^./\\]+$/, "") || "image"}.webp`;
}

/** Returns a file to upload in place of `file`: the original if it is already
 * a small-enough raster image, otherwise a WebP within `preset`. Throws
 * ImageCompressionError for a file that isn't a decodable image or can't be
 * made small enough. */
export async function compressImage(file: File, preset: ImagePreset, codec: ImageCodec = browserCodec): Promise<File> {
  if (!file.type.startsWith("image/") || file.type === "image/svg+xml") {
    throw new ImageCompressionError("Not a supported image type.");
  }

  let decoded: DecodedImage;
  try {
    decoded = await codec.decode(file);
  } catch {
    throw new ImageCompressionError("Could not read this image.");
  }

  const fits = Math.max(decoded.width, decoded.height) <= preset.maxDimension;
  if (fits && file.size <= preset.maxBytes && file.type !== "image/gif") return file;

  let { width, height } = fitWithin(decoded.width, decoded.height, preset.maxDimension);
  for (let round = 0; round <= MAX_SHRINK_ROUNDS; round++) {
    for (const quality of QUALITY_STEPS) {
      const blob = await codec.encode(decoded, width, height, quality);
      if (blob.size <= preset.maxBytes) return new File([blob], webpName(file.name), { type: "image/webp" });
    }
    width = Math.max(1, Math.round(width * SHRINK_FACTOR));
    height = Math.max(1, Math.round(height * SHRINK_FACTOR));
  }
  throw new ImageCompressionError("This image can't be made small enough.");
}
