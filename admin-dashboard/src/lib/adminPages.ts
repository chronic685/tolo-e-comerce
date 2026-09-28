import {
  LayoutDashboard,
  ClipboardList,
  Truck,
  Undo2,
  LifeBuoy,
  Store,
  Package,
  Users as UsersIcon,
  Boxes,
  CreditCard,
  Tag,
  Wallet,
  Bell,
  UserCog,
  History,
  Settings as SettingsIcon,
  FileBarChart,
  Image as ImageIcon,
  type LucideIcon,
} from "lucide-react";

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
  icon: LucideIcon;
  // Sidebar section heading. Dashboard has none (rendered above every
  // group, as the sole ungrouped entry).
  group?: "Operations" | "Catalog" | "Finance" | "Platform";
}

export const ADMIN_PAGES: AdminPage[] = [
  { key: "dashboard", label: "Dashboard", to: "/", end: true, icon: LayoutDashboard },

  { key: "orders", label: "Orders", to: "/orders", icon: ClipboardList, group: "Operations" },
  { key: "delivery_ops", label: "Delivery Ops", to: "/delivery-ops", icon: Truck, group: "Operations" },
  { key: "refunds", label: "Refunds", to: "/refunds", icon: Undo2, group: "Operations" },
  { key: "support", label: "Support", to: "/support", icon: LifeBuoy, group: "Operations" },

  { key: "merchants", label: "Merchants", to: "/merchants", icon: Store, group: "Catalog" },
  { key: "products", label: "Products", to: "/products", icon: Package, group: "Catalog" },
  { key: "customers", label: "Customers", to: "/customers", icon: UsersIcon, group: "Catalog" },
  { key: "banners", label: "Homepage Banners", to: "/banners", icon: ImageIcon, group: "Catalog" },
  {
    key: "inventory_movements",
    label: "Inventory Movements",
    to: "/inventory-movements",
    hiddenFromNav: true,
    icon: Boxes,
    group: "Catalog",
  },

  { key: "payments", label: "Payments", to: "/payments", icon: CreditCard, group: "Finance" },
  { key: "pricing_rules", label: "Pricing Rules", to: "/pricing-rules", icon: Tag, group: "Finance" },
  { key: "settlements", label: "Settlements", to: "/settlements", icon: Wallet, group: "Finance" },
  {
    key: "finance_reconciliation",
    label: "Finance Reconciliation",
    to: "/finance-reconciliation",
    icon: FileBarChart,
    group: "Finance",
  },

  { key: "notification_templates", label: "Notification Templates", to: "/notification-templates", icon: Bell, group: "Platform" },
  { key: "users", label: "Users & Roles", to: "/users", icon: UserCog, group: "Platform" },
  { key: "audit_log", label: "Audit Log", to: "/audit-log", icon: History, group: "Platform" },
  { key: "settings", label: "Settings", to: "/settings", icon: SettingsIcon, group: "Platform" },
];
