import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { ClipboardList, FileCheck2, KeyRound, LogOut, Menu, Package, Search, X } from "lucide-react";
import {
  CommandPalette,
  LanguageSwitcher,
  ThemeToggle,
  formatOrderNumber,
  useTranslation,
  type CommandPaletteHandle,
  type CommandPaletteItem,
} from "@tolo/ui";
import { useAuth } from "../lib/AuthContext";
import { ADMIN_PAGES, type AdminPage } from "../lib/adminPages";
import { supabase } from "../lib/supabase";
import { parseOrderNumberQuery } from "../lib/search";

const GROUP_ORDER: NonNullable<AdminPage["group"]>[] = ["Operations", "Catalog", "Finance", "Platform"];

export function Layout() {
  const { user, role, adminTier, hasAccess, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [fullName, setFullName] = useState<string | null>(null);
  const paletteRef = useRef<CommandPaletteHandle>(null);

  useEffect(() => {
    if (!user) return;
    supabase
      .from("profiles")
      .select("full_name")
      .eq("id", user.id)
      .maybeSingle()
      .then(({ data }) => setFullName(data?.full_name ?? null));
  }, [user]);

  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  // Nav only ever shows pages this staff member can actually open (super
  // admins see everything regardless of their own permissions list) — this
  // is a convenience, not the enforcement; PageGuard on each route is what
  // actually stops a direct URL visit.
  const visiblePages = ADMIN_PAGES.filter((item) => !item.hiddenFromNav && hasAccess(item.key));
  const dashboardItem = visiblePages.find((p) => !p.group);
  const groupedItems = GROUP_ORDER.map((group) => ({
    group,
    items: visiblePages.filter((p) => p.group === group),
  })).filter((g) => g.items.length > 0);

  // Item 5: the command palette's page list is built from the exact same
  // permission-filtered `visiblePages` the sidebar nav already uses (not
  // the raw ADMIN_PAGES) -- a page this staff member can't open never even
  // reaches the palette to be shown or searched.
  const paletteItems: CommandPaletteItem[] = ADMIN_PAGES.filter((item) => hasAccess(item.key)).map((item) => ({
    key: item.key,
    label: t(item.labelKey),
    to: item.to,
    icon: item.icon,
    group: t("commandPalette.pages"),
  }));
  // Applications are a tab of the Merchants page now, but still worth a direct palette entry for admin tier.
  if (adminTier) {
    paletteItems.push({
      key: "merchant_applications",
      label: t("merchantApplications.title"),
      to: "/merchants?tab=applications",
      icon: FileCheck2,
      group: t("commandPalette.pages"),
    });
  }

  async function searchOrdersAndProducts(query: string): Promise<CommandPaletteItem[]> {
    const results: CommandPaletteItem[] = [];

    // Same permission gate as the pages themselves -- a staff member who
    // can't open Orders/Products shouldn't be able to search their way to
    // one through the palette either.
    if (hasAccess("orders")) {
      const orderNumber = parseOrderNumberQuery(query);
      if (orderNumber !== null) {
        const { data } = await supabase.from("orders").select("id, order_number").eq("order_number", orderNumber).limit(5);
        for (const order of (data ?? []) as { id: string; order_number: number }[]) {
          results.push({ key: `order-${order.id}`, label: formatOrderNumber(order.order_number), to: `/orders?order=${order.id}`, icon: ClipboardList, group: t("commandPalette.orders") });
        }
      }
    }

    if (hasAccess("products")) {
      const { data } = await supabase.from("products").select("id, name").ilike("name", `%${query}%`).limit(5);
      for (const product of (data ?? []) as { id: string; name: string }[]) {
        results.push({ key: `product-${product.id}`, label: product.name, to: `/products?product=${product.id}`, icon: Package, group: t("commandPalette.products") });
      }
    }

    return results;
  }

  const tierLabel =
    adminTier === "super_admin"
      ? t("adminNav.superAdmin")
      : adminTier === "admin"
        ? t("adminNav.admin")
        : role
          ? t(`staffRole.${role}`) === `staffRole.${role}`
            ? role.replaceAll("_", " ")
            : t(`staffRole.${role}`)
          : t("adminNav.staff");

  async function handleSignOut() {
    await signOut();
    navigate("/login");
  }

  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-3 px-4 py-2 text-sm ${isActive ? "bg-navy text-white" : "text-slate-300 hover:bg-navy"}`;

  return (
    <div className="min-h-screen flex">
      {/* Mobile top bar */}
      <div className="md:hidden fixed top-0 inset-x-0 z-20 bg-navy-dark text-white flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2 min-w-0">
          <img src="/logo.png" alt="" className="h-7 w-7 flex-shrink-0" />
          <p className="text-sm font-bold truncate">{t("admin.appName")}</p>
        </div>
        <button onClick={() => setMenuOpen(true)} aria-label={t("nav.openMenu")} className="p-1">
          <Menu className="w-6 h-6" />
        </button>
      </div>

      {menuOpen && <div className="md:hidden fixed inset-0 bg-black/50 z-30" onClick={() => setMenuOpen(false)} />}

      <aside
        className={`w-64 md:w-56 bg-navy-dark text-slate-200 flex flex-col fixed md:static inset-y-0 left-0 z-40 overflow-y-auto transition-transform ${
          menuOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        }`}
      >
        <div className="px-4 py-5 border-b border-navy-light/40 flex items-center gap-2">
          <img src="/logo.png" alt="" className="h-8 w-8 flex-shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-lg font-bold text-white leading-tight">{t("admin.appName")}</p>
            <p className="text-xs text-slate-400 truncate">{fullName ?? t("adminNav.nameLoading")}</p>
            <span className="inline-block mt-1 text-[10px] font-medium capitalize bg-navy-light/50 text-white rounded-full px-2 py-0.5">
              {tierLabel}
            </span>
          </div>
          <button onClick={() => setMenuOpen(false)} aria-label={t("nav.closeMenu")} className="md:hidden p-1 flex-shrink-0">
            <X className="w-5 h-5" />
          </button>
        </div>

        <button
          type="button"
          onClick={() => paletteRef.current?.open()}
          className="mx-4 mt-3 flex items-center gap-2 px-3 py-1.5 rounded-md border border-navy-light/40 text-slate-400 text-xs hover:text-slate-200 hover:border-navy-light"
        >
          <Search className="w-3.5 h-3.5 flex-shrink-0" />
          <span className="flex-1 text-left">{t("commandPalette.placeholder")}</span>
          <kbd className="text-[10px] border border-navy-light/40 rounded px-1 py-0.5">Ctrl K</kbd>
        </button>

        <nav className="flex-1 py-3">
          {dashboardItem && (
            <NavLink to={dashboardItem.to} end={dashboardItem.end} className={navLinkClass}>
              <dashboardItem.icon className="w-4 h-4 flex-shrink-0" />
              {t(dashboardItem.labelKey)}
            </NavLink>
          )}

          {groupedItems.map(({ group, items }) => (
            <div key={group} className="mt-3">
              <p className="px-4 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">{t(`adminNav.group.${group}`)}</p>
              {items.map((item) => (
                <NavLink key={item.to} to={item.to} end={item.end} className={navLinkClass}>
                  <item.icon className="w-4 h-4 flex-shrink-0" />
                  {t(item.labelKey)}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="px-4 py-2 border-t border-navy-light/40 flex items-center justify-between gap-2">
          <LanguageSwitcher variant="full" className="text-slate-300" />
          <ThemeToggle className="text-slate-300" />
        </div>
        <NavLink
          to="/account/password"
          className={({ isActive }) =>
            `flex items-center gap-3 px-4 py-2 text-sm border-t border-navy-light/40 ${isActive ? "bg-navy text-white" : "text-slate-300 hover:bg-navy"}`
          }
        >
          <KeyRound className="w-4 h-4" />
          {t("admin.changePassword")}
        </NavLink>
        <button
          onClick={handleSignOut}
          className="flex items-center gap-3 px-4 py-3 text-sm text-left text-slate-300 hover:bg-navy border-t border-navy-light/40"
        >
          <LogOut className="w-4 h-4" />
          {t("common.signOut")}
        </button>
      </aside>

      <main className="flex-1 p-4 pt-20 md:p-6 md:pt-6 max-w-6xl">
        <Outlet />
      </main>

      <CommandPalette ref={paletteRef} pages={paletteItems} onSearch={searchOrdersAndProducts} />
    </div>
  );
}
