export interface Category {
  id: string;
  name: string;
  slug: string;
  image_url: string | null;
}

export interface ProductImage {
  id: string;
  url: string;
  is_primary: boolean;
  variant_id: string | null;
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
}

export interface Product {
  id: string;
  merchant_id: string;
  store_id: string;
  category_id: string | null;
  name: string;
  slug: string;
  description: string | null;
  base_price: number;
  discount_price: number | null;
  status: string;
  /** Server-computed: base_price + commission. Always use this for display — never compute it client-side. */
  customer_price: number;
  product_variants: ProductVariant[];
  product_images: ProductImage[];
  stores?: { name: string; slug: string } | null;
  /** Only present when explicitly selected (Marketplace.tsx, for the rating
   * sort) — no aggregate/average rating column exists anywhere, so this is
   * the raw per-review rows, averaged client-side where needed. */
  reviews?: { rating: number }[];
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
  merchants: ({ status: string } & MerchantRating) | null;
}

export interface CartItem {
  id: string;
  cart_id: string;
  variant_id: string;
  quantity: number;
  product_variants: ProductVariant & {
    products: {
      id: string;
      name: string;
      slug: string;
      merchant_id: string;
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
