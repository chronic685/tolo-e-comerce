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

export interface SupportTicket {
  id: string;
  user_id: string;
  subject: string;
  body: string | null;
  status: string;
  created_at: string;
}
