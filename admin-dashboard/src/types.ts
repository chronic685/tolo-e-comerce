export interface Merchant {
  id: string;
  owner_id: string;
  business_name: string;
  business_category: string | null;
  phone: string | null;
  email: string | null;
  location: string | null;
  status: string;
  agreement_accepted: boolean;
  created_at: string;
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
  merchant_orders: { id: string; merchant_id: string; status: string; subtotal: number; merchants: { business_name: string } | null }[];
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

export interface SupportTicket {
  id: string;
  user_id: string;
  subject: string;
  body: string | null;
  status: string;
  created_at: string;
}
