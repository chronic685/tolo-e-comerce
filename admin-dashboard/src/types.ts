export interface Merchant {
  id: string;
  owner_id: string;
  business_name: string;
  business_category: string | null;
  business_subcategory: string | null;
  phone: string | null;
  email: string | null;
  location: string | null;
  city: string | null;
  sub_city: string | null;
  woreda: string | null;
  landmark: string | null;
  owner_full_name: string | null;
  owner_phone: string | null;
  owner_email: string | null;
  status: string;
  rejection_reason: string | null;
  suspension_reason: string | null;
  agreement_accepted: boolean;
  created_at: string;
}

export interface MerchantDocument {
  id: string;
  merchant_id: string;
  doc_type: string;
  file_url: string;
  file_name: string | null;
  status: string;
  rejection_reason: string | null;
  uploaded_at: string;
}

export interface Category {
  id: string;
  name: string;
  slug: string;
  parent_id: string | null;
  is_active: boolean;
  sort_order: number;
}

export interface CommissionRule {
  id: string;
  scope_type: string;
  scope_id: string | null;
  rate_percent: number;
  is_active: boolean;
}

export interface OrderRow {
  id: string;
  customer_id: string;
  total: number;
  payment_status: string;
  created_at: string;
  merchant_orders: {
    id: string;
    merchant_id: string;
    status: string;
    subtotal: number;
    notification_sent_at: string | null;
    order_received_at: string | null;
    merchants: { business_name: string } | null;
  }[];
}

export interface Settlement {
  id: string;
  merchant_id: string;
  period_start: string;
  period_end: string;
  total_amount: number;
  status: string;
  created_at: string;
  merchants: { business_name: string } | null;
}

export interface Driver {
  id: string;
  full_name: string;
  phone: string;
  vehicle_type: string | null;
  vehicle_plate: string | null;
  is_active: boolean;
}

export interface Delivery {
  id: string;
  merchant_order_id: string;
  driver_id: string | null;
  status: string;
  pickup_address: string | null;
  pickup_contact_name: string | null;
  pickup_contact_phone: string | null;
  dropoff_address: string | null;
  dropoff_contact_name: string | null;
  dropoff_contact_phone: string | null;
  created_at: string;
  drivers: { full_name: string } | null;
  merchant_orders: { merchants: { business_name: string } | null } | null;
}

export interface DiscountRule {
  id: string;
  name: string;
  description: string | null;
  scope_type: "platform" | "merchant" | "category" | "product";
  scope_id: string | null;
  discount_kind: "percent" | "fixed";
  amount: number;
  max_discount_amount: number | null;
  min_order_value: number;
  funded_by: "tolo" | "merchant" | "shared";
  tolo_share_percent: number | null;
  usage_limit: number | null;
  usage_count: number;
  per_customer_limit: number | null;
  first_order_only: boolean;
  starts_at: string | null;
  ends_at: string | null;
  is_active: boolean;
  created_at: string;
}

export interface SystemSetting {
  key: string;
  value: unknown;
  updated_at: string;
}

export interface AdminProduct {
  id: string;
  merchant_id: string;
  name: string;
  slug: string;
  sku: string | null;
  base_price: number;
  status: "draft" | "submitted" | "approved" | "published" | "paused" | "archived";
  rejection_reason: string | null;
  is_featured: boolean;
  created_at: string;
  merchants: { business_name: string } | null;
  categories: { name: string } | null;
}

export interface ReturnRow {
  id: string;
  merchant_order_id: string;
  customer_id: string;
  reason: string;
  status: "requested" | "approved" | "rejected" | "received" | "completed";
  created_at: string;
  merchant_orders: { subtotal: number; merchants: { business_name: string } | null } | null;
  profiles: { full_name: string | null; phone: string | null } | null;
  refunds: { id: string; amount: number; status: string }[];
}

export interface StaffProfile {
  id: string;
  full_name: string | null;
  phone: string | null;
  role: string;
  account_status: "active" | "suspended";
  created_at: string;
}

export interface CustomerProfile {
  id: string;
  full_name: string | null;
  phone: string | null;
  account_status: "active" | "suspended";
  created_at: string;
}

export interface AuditLogEntry {
  id: string;
  actor_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  profiles: { full_name: string | null } | null;
}

export interface DeliveryZone {
  id: string;
  name: string;
  description: string | null;
  center_latitude: number;
  center_longitude: number;
  radius_km: number;
  delivery_fee: number;
  free_delivery_threshold: number | null;
  max_distance_km: number | null;
  estimated_delivery_minutes: number | null;
  is_active: boolean;
  created_at: string;
}

export interface NotificationTemplate {
  id: string;
  event_type: string;
  channel: string;
  language: string;
  title_template: string;
  body_template: string;
  enabled: boolean;
  updated_at: string;
}

export interface FinancialAdjustment {
  id: string;
  merchant_id: string;
  order_id: string | null;
  settlement_id: string | null;
  type: string;
  amount: number;
  reason: string;
  created_at: string;
  merchants: { business_name: string } | null;
}

export interface InventoryMovement {
  id: string;
  variant_id: string;
  movement_type: string;
  quantity: number;
  reference_type: string | null;
  reference_id: string | null;
  created_at: string;
  product_variants: { sku: string | null; products: { name: string } | null } | null;
}

export interface Payment {
  id: string;
  order_id: string;
  provider: string;
  amount: number;
  currency: string;
  status: "pending" | "verified" | "failed" | "refunded";
  created_at: string;
  orders: { customer_id: string; profiles: { full_name: string | null; phone: string | null } | null } | null;
}

export interface SupportTicket {
  id: string;
  user_id: string;
  subject: string;
  body: string | null;
  status: string;
  created_at: string;
}
