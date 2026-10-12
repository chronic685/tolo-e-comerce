export interface Category {
  id: string;
  name: string;
  /** Optional Amharic name (categories.name_am); shown instead of `name` in Amharic. */
  name_am: string | null;
  slug: string;
  icon: string;
  color: string;
}

export interface ProductImage {
  id: string;
  url: string;
  is_primary: boolean;
  variant_id: string | null;
  /** Only present where explicitly selected (ProductDetail.tsx, for gallery ordering). */
  sort_order?: number;
}

export interface ProductVariant {
  id: string;
  sku: string | null;
  attributes: Record<string, string>;
  price: number;
  discount_price: number | null;
  is_default: boolean;
  /** Server-computed: merchant price + commission. Always use this for display — never compute it client-side. */
  customer_price: number;
  /** Server-computed (variant_stock_status, migration 0054) — only present
   * where explicitly selected. Never a raw stock number; "low" is the only
   * case stock_remaining is non-null, and even then it's capped at 5. */
  stock_status?: "in_stock" | "low" | "out_of_stock";
  stock_remaining?: number | null;
  /** The most one order may take (the API backend, which gives no stock counts): the quantity box's maximum. */
  max_order_quantity?: number;
}

export interface Product {
  id: string;
  merchant_id: string;
  store_id: string;
  category_id: string | null;
  /** Only present where explicitly selected (Storefront.tsx, for grouping
   * a shop's products by category). */
  categories?: { name: string } | null;
  name: string;
  slug: string;
  description: string | null;
  base_price: number;
  discount_price: number | null;
  status: string;
  /** Server-computed: base_price + commission. Always use this for display — never compute it client-side. */
  customer_price: number;
  /** True when any variant has stock. Set by the API backend, whose product list carries no variants to read stock from. */
  in_stock?: boolean;
  product_variants: ProductVariant[];
  product_images: ProductImage[];
  stores?: { name: string; slug: string; logo_url?: string | null } | null;
  /** Only present on ProductDetail.tsx's single-product fetch — the
   * merchant-level rating, server-computed (merchants_avg_rating/
   * merchants_review_count). Not selected on grid pages (Marketplace.tsx/
   * Storefront.tsx's product list) to avoid re-computing the same
   * merchant's aggregate once per card. */
  merchants?: MerchantRating | null;
}

export interface MerchantRating {
  avg_rating: number | null;
  review_count: number;
}

export interface StorefrontStore {
  id: string;
  merchant_id: string;
  name: string;
  slug: string;
  description: string | null;
  logo_url: string | null;
  banner_url: string | null;
  status: string;
  operating_hours: import("@tolo/ui").OperatingHours;
  is_open_now: boolean;
  prep_time_minutes: number | null;
  merchants: ({ status: string } & MerchantRating) | null;
}

export type UnavailablePreference = "remove" | "substitute" | "cancel_order";

export interface CartItem {
  id: string;
  cart_id: string;
  variant_id: string;
  quantity: number;
  on_unavailable: UnavailablePreference;
  product_variants: ProductVariant & {
    products: {
      id: string;
      name: string;
      slug: string;
      merchant_id: string;
      category_id: string | null;
      product_images: { url: string; is_primary: boolean }[];
    };
  };
}

export interface Address {
  id: string;
  label: string | null;
  recipient_name: string;
  phone: string;
  line1: string;
  line2: string | null;
  city: string;
  sub_city?: string | null;
  landmark?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  region: string | null;
  country: string;
  is_default: boolean;
}

export interface Notification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  is_read: boolean;
  created_at: string;
}

export interface SupportTicket {
  id: string;
  subject: string;
  body: string | null;
  status: string;
  created_at: string;
  merchant_order_id: string | null;
  merchant_orders?: { order_id: string; merchants: { business_name: string } | null } | null;
}

export interface MerchantOrderSummary {
  id: string;
  order_id: string;
  merchant_id: string;
  status: string;
  subtotal: number;
  created_at: string;
}
