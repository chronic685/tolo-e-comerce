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
  // i18n key, resolved with t() at render time -- never store display text here.
  labelKey: string;
  to: string;
  end?: boolean;
  // Removed from the visible sidebar nav only — the route, its guard, and
  // its entry in the permissions checklist all stay fully intact. Flip
  // this back to false (or delete the line) to re-show it; nothing else
  // needs to change.
  hiddenFromNav?: boolean;
  // Admin/super_admin only: never grantable to staff through the page
  // checklist (Users.tsx leaves it out), because the data behind it is
  // gated on is_tolo_admin() in RLS, not on page permissions.
  adminTierOnly?: boolean;
  icon: LucideIcon;
  // Sidebar section heading. Dashboard has none (rendered above every
  // group, as the sole ungrouped entry).
  group?: "Operations" | "Catalog" | "Finance" | "Platform";
}

export const ADMIN_PAGES: AdminPage[] = [
  { key: "dashboard", labelKey: "nav.dashboard", to: "/", end: true, icon: LayoutDashboard },

  { key: "orders", labelKey: "nav.orders", to: "/orders", icon: ClipboardList, group: "Operations" },
  { key: "delivery_ops", labelKey: "nav.deliveryOps", to: "/delivery-ops", icon: Truck, group: "Operations" },
  { key: "refunds", labelKey: "nav.refunds", to: "/refunds", icon: Undo2, group: "Operations" },
  { key: "support", labelKey: "nav.support", to: "/support", icon: LifeBuoy, group: "Operations" },

  // Merchants and Merchant Applications are one page: the Applications tab (admin tier only) lives inside it.
  { key: "merchants", labelKey: "nav.merchants", to: "/merchants", icon: Store, group: "Catalog" },
  { key: "products", labelKey: "nav.products", to: "/products", icon: Package, group: "Catalog" },
  { key: "customers", labelKey: "nav.customers", to: "/customers", icon: UsersIcon, group: "Catalog" },
  { key: "banners", labelKey: "nav.banners", to: "/banners", icon: ImageIcon, group: "Catalog" },
  {
    key: "inventory_movements",
    labelKey: "inventoryMovements.title",
    to: "/inventory-movements",
    hiddenFromNav: true,
    icon: Boxes,
    group: "Catalog",
  },

  { key: "payments", labelKey: "nav.payments", to: "/payments", icon: CreditCard, group: "Finance" },
  { key: "pricing_rules", labelKey: "nav.pricingRules", to: "/pricing-rules", icon: Tag, group: "Finance" },
  { key: "settlements", labelKey: "nav.settlements", to: "/settlements", icon: Wallet, group: "Finance" },
  {
    key: "finance_reconciliation",
    labelKey: "nav.financeReconciliation",
    to: "/finance-reconciliation",
    icon: FileBarChart,
    group: "Finance",
  },

  { key: "notification_templates", labelKey: "nav.notificationTemplates", to: "/notification-templates", icon: Bell, group: "Platform" },
  { key: "users", labelKey: "nav.users", to: "/users", icon: UserCog, group: "Platform" },
  { key: "audit_log", labelKey: "nav.auditLog", to: "/audit-log", icon: History, group: "Platform" },
  { key: "settings", labelKey: "nav.settings", to: "/settings", icon: SettingsIcon, group: "Platform" },
];

/** Pages a staff member can be granted through the Users & Roles checklist. */
export const GRANTABLE_ADMIN_PAGES = ADMIN_PAGES.filter((page) => !page.adminTierOnly);
