// Single source of truth for every gated admin page — Layout.tsx's sidebar
// nav, the per-route PageGuard in App.tsx, and the permissions checklist in
// Users.tsx all read from this same list so they can never drift out of
// sync with each other. `key` is what's stored in profiles.permissions
// (migration 0049); `to`/`end` mirror exactly what the nav already used.
export interface AdminPage {
  key: string;
  label: string;
  to: string;
  end?: boolean;
  // Removed from the visible sidebar nav only — the route, its guard, and
  // its entry in the permissions checklist all stay fully intact. Flip
  // this back to false (or delete the line) to re-show it; nothing else
  // needs to change.
  hiddenFromNav?: boolean;
}

export const ADMIN_PAGES: AdminPage[] = [
  { key: "dashboard", label: "Dashboard", to: "/", end: true },
  { key: "orders", label: "Orders", to: "/orders" },
  { key: "payments", label: "Payments", to: "/payments" },
  { key: "merchants", label: "Merchants", to: "/merchants" },
  { key: "products", label: "Products", to: "/products" },
  { key: "customers", label: "Customers", to: "/customers" },
  { key: "delivery_ops", label: "Delivery Ops", to: "/delivery-ops" },
  { key: "pricing_rules", label: "Pricing Rules", to: "/pricing-rules" },
  { key: "refunds", label: "Refunds", to: "/refunds" },
  { key: "settlements", label: "Settlements", to: "/settlements" },
  { key: "inventory_movements", label: "Inventory Movements", to: "/inventory-movements", hiddenFromNav: true },
  { key: "notification_templates", label: "Notification Templates", to: "/notification-templates" },
  { key: "support", label: "Support", to: "/support" },
  { key: "users", label: "Users & Roles", to: "/users" },
  { key: "audit_log", label: "Audit Log", to: "/audit-log" },
  { key: "settings", label: "Settings", to: "/settings" },
];
