export interface Merchant {
  id: string;
  owner_id: string;
  business_name: string;
  business_category: string | null;
  phone: string | null;
  email: string | null;
  location: string | null;
  status: string;
}

export interface Store {
  id: string;
  merchant_id: string;
  name: string;
  slug: string;
  description: string | null;
  logo_url: string | null;
  banner_url: string | null;
  status: string;
}

export interface Category {
  id: string;
  name: string;
  slug: string;
}

export interface ProductVariant {
  id: string;
  product_id: string;
  sku: string | null;
  attributes: Record<string, string>;
  price: number;
  discount_price: number | null;
  is_default: boolean;
  inventory: { stock_quantity: number; reserved_quantity: number; available_quantity: number } | null;
}

export interface ProductImage {
  id: string;
  url: string;
  is_primary: boolean;
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
  product_variants: ProductVariant[];
  product_images: ProductImage[];
  categories: { name: string } | null;
}

export interface OrderItem {
  id: string;
  product_name_snapshot: string;
  variant_attributes_snapshot: Record<string, string>;
  unit_price: number;
  quantity: number;
  subtotal: number;
}

export interface MerchantOrder {
  id: string;
  order_id: string;
  merchant_id: string;
  status: string;
  subtotal: number;
  commission_amount: number;
  merchant_payable: number;
  created_at: string;
  order_items: OrderItem[];
  orders: {
    addresses: { recipient_name: string; phone: string; line1: string; city: string } | null;
  } | null;
}

export interface WalletTransaction {
  id: string;
  type: string;
  amount: number;
  balance_after: number;
  note: string | null;
  created_at: string;
}
