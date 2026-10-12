import type { Category, Product } from "../../types";

/** The merchant and store the signed-in user works for, as the Supabase backend knows them. The API backend ignores it: it works out the caller's own shop. */
export interface ShopRef {
  merchantId: string;
  storeId: string;
}

export type ProductTab = "active" | "archived";

export interface VariantInput {
  id?: string;
  sku: string | null;
  attributes: Record<string, string>;
  price: number;
  stock: number;
  isDefault: boolean;
  // Undefined lets the inventory table's own default (5) apply -- only ProductForm.tsx's per-variant editor sets this explicitly today. The API has no such threshold.
  lowStockThreshold?: number;
}

export interface ImageInput {
  id?: string;
  url: string;
  /** A picture chosen from this computer and not yet stored: the API backend uploads it when the product is saved. */
  file?: File;
}

export interface ProductInput {
  categoryId: string | null;
  name: string;
  slug: string;
  description: string | null;
  basePrice: number;
  status: "draft" | "published" | "submitted" | "paused" | "approved";
}

export type SaveProductResult = { ok: true; productId: string; warnings?: string[] } | { ok: false; error: string; variantInUse?: boolean };

export type ActionResult = { ok: true } | { ok: false; error: string };

/** A product as the edit form needs it. */
export interface LoadedProduct {
  name: string;
  description: string | null;
  categoryId: string | null;
  basePrice: number;
  status: string;
  archivedBy: "merchant" | "staff" | null;
  variants: { id: string; sku: string | null; attributes: Record<string, string>; price: number; stock: number; lowStockThreshold: number }[];
  images: { id: string; url: string }[];
}

export interface Removals {
  variantIds: string[];
  imageIds: string[];
}

/**
 * What the merchant's product screens need (list, hide/show, archive/restore, delete, edit with variants and images). Two implementations:
 * Supabase (the writes the screens made directly, moved here unchanged) and the C# API. Screens import `merchantProducts` from ./index.
 */
export interface MerchantProductsBackend {
  list(ref: ShopRef, tab: ProductTab, page: number, pageSize: number): Promise<{ items: Product[]; total: number }>;
  /** Every product of the tab (the CSV export). */
  listAll(ref: ShopRef, tab: ProductTab): Promise<Product[]>;
  setVisible(ids: string[], visible: boolean): Promise<ActionResult>;
  archive(ids: string[]): Promise<{ ok: true; count: number } | { ok: false; error: string }>;
  restore(ids: string[]): Promise<{ ok: true; restored: number; blocked: number } | { ok: false; error: string }>;
  /** Whether any order refers to the product (it then cannot be deleted, only archived). The API backend cannot ask: it answers false and the delete itself reports it. */
  hasOrders(id: string): Promise<{ ok: true; hasOrders: boolean } | { ok: false; error: string }>;
  remove(id: string): Promise<{ ok: true } | { ok: false; error: string; hasOrders?: boolean }>;
  load(id: string): Promise<LoadedProduct | null>;
  categories(): Promise<Category[]>;
  /** The commission rate the merchant pays, as a percent, or null when it is not known. */
  commissionRate(ref: ShopRef, categoryId: string): Promise<number | null>;
  /** Prepares a picture the merchant chose. The Supabase backend stores it at once and returns its URL; the API backend keeps the file and uploads it with the product. */
  prepareImage(ref: ShopRef, file: File): Promise<{ ok: true; url: string; file?: File } | { ok: false; error: string; prepareFailed?: boolean }>;
  save(ref: ShopRef, product: ProductInput, variants: VariantInput[], images: ImageInput[], existingProductId?: string, removals?: Removals): Promise<SaveProductResult>;
}
