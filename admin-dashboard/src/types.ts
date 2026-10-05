export interface Merchant {
  id: string;
  owner_id: string;
  business_name: string;
  /** Legacy free text from before category_id; read-only, shown only until an admin confirms a category. */
  business_category: string | null;
  business_subcategory: string | null;
  category_id: string | null;
  categories?: { name: string } | null;
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
  /** Optional Amharic name, shown to customers in Amharic (migration 0089). */
  name_am: string | null;
  icon: string;
  color: string;
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
  order_number: number;
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
    escalated_at: string | null;
    merchants: { business_name: string } | null;
    // PostgREST embeds the one-to-one delivery_jobs row as an object, null when none.
    delivery_jobs: { needs_manual_handling: boolean; handoff_error: string | null } | null;
  }[];
}

// One row per unacknowledged merchant_order (queried directly off
// merchant_orders, not orders — see merchant_orders_unacknowledged(),
// migration 0055) rather than grouped by parent order, so the queue can be
// exactly-counted and .range()-paginated by the database instead of a
// capped fetch that could hide older, more-overdue rows.
export interface UnacknowledgedMerchantOrderRow {
  id: string;
  merchant_id: string;
  status: string;
  subtotal: number;
  notification_sent_at: string | null;
  order_received_at: string | null;
  escalated_at: string | null;
  merchants: { business_name: string } | null;
  orders: { id: string; order_number: number; total: number; payment_status: string; created_at: string } | null;
}

export interface Settlement {
  id: string;
  merchant_id: string;
  period_start: string;
  period_end: string;
  total_amount: number;
  status: string;
  created_at: string;
  paid_at: string | null;
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
  code: string | null;
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
  /** Set by the database when status becomes archived (migration 0092). */
  archived_at: string | null;
  archived_by_role: "merchant" | "staff" | null;
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

// Refunds.tsx's "Refunds" queue, queried directly from `refunds` (each row
// is a refund that actually exists) rather than derived client-side from
// `returns` -- the nested `returns` carries what the row needs to display.
export interface RefundRow {
  id: string;
  amount: number;
  status: string;
  processed_at: string | null;
  return_id: string;
  returns: {
    id: string;
    reason: string;
    created_at: string;
    merchant_orders: { subtotal: number; merchants: { business_name: string } | null } | null;
    profiles: { full_name: string | null; phone: string | null } | null;
  } | null;
}

export interface StaffProfile {
  id: string;
  full_name: string | null;
  phone: string | null;
  role: string;
  account_status: "active" | "suspended";
  suspension_reason: string | null;
  permissions: string[];
  admin_tier: "admin" | "super_admin" | null;
  username: string | null;
  created_at: string;
}

export interface CustomerProfile {
  id: string;
  full_name: string | null;
  phone: string | null;
  account_status: "active" | "suspended";
  suspension_reason: string | null;
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
  orders: { order_number: number; customer_id: string; profiles: { full_name: string | null; phone: string | null } | null } | null;
}

export interface SupportTicket {
  id: string;
  user_id: string;
  subject: string;
  body: string | null;
  status: string;
  created_at: string;
  merchant_order_id: string | null;
  photo_url: string | null;
  merchant_orders?: { order_id: string; merchants: { business_name: string } | null } | null;
}
