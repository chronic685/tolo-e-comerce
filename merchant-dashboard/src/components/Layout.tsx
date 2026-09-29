import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { LayoutDashboard, ClipboardList, Wallet as WalletIcon, Store, Users, LogOut, Menu, X, Package, Tag, LifeBuoy } from "lucide-react";
import { LanguageSwitcher, useTranslation } from "@tolo/ui";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/AuthContext";
import { useMerchant } from "../lib/MerchantContext";
import { NewOrderAlert } from "./NewOrderAlert";

export function Layout() {
  const { signOut } = useAuth();
  const { merchant, store } = useMerchant();
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation();
  const [staffAccountsEnabled, setStaffAccountsEnabled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const BASE_NAV_ITEMS = [
    { to: "/", label: t("nav.dashboard"), end: true, icon: LayoutDashboard },
    { to: "/products", label: t("nav.products"), icon: Package },
    { to: "/promotions", label: t("nav.promotions"), icon: Tag },
    { to: "/orders", label: t("nav.orders"), icon: ClipboardList },
    { to: "/wallet", label: t("nav.wallet"), icon: WalletIcon },
    { to: "/support", label: t("nav.reportedIssues"), icon: LifeBuoy },
    { to: "/store", label: t("nav.storeSettings"), icon: Store },
  ];

  useEffect(() => {
    // Same platform-wide toggle Staff.tsx itself re-checks — hidden from
    // the nav here, but the page also gates itself in case Tolo turns this
    // off while a merchant already has the URL open or bookmarked.
    supabase
      .from("system_settings")
      .select("value")
      .eq("key", "merchant_features")
      .maybeSingle()
      .then(({ data }) => {
        const features = data?.value as { staff_accounts_enabled?: boolean } | null;
        setStaffAccountsEnabled(features?.staff_accounts_enabled ?? false);
      });
  }, []);

  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  const navItems = staffAccountsEnabled
    ? [...BASE_NAV_ITEMS, { to: "/staff", label: t("nav.staff"), end: undefined, icon: Users }]
    : BASE_NAV_ITEMS;

  async function handleSignOut() {
    await signOut();
    navigate("/login");
  }

  return (
    <div className="min-h-screen flex">
      {/* Mobile top bar */}
      <div className="md:hidden fixed top-0 inset-x-0 z-20 bg-navy-dark text-white flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2 min-w-0">
          <img src="/logo.png" alt="" className="h-7 w-7 flex-shrink-0" />
          <p className="text-sm font-bold truncate">{store?.name ?? merchant?.business_name ?? t("merchant.appName")}</p>
        </div>
        <button onClick={() => setMenuOpen(true)} aria-label={t("nav.openMenu")} className="p-1">
          <Menu className="w-6 h-6" />
        </button>
      </div>

      {menuOpen && <div className="md:hidden fixed inset-0 bg-black/50 z-30" onClick={() => setMenuOpen(false)} />}

      <aside
        className={`w-64 md:w-56 bg-navy-dark text-gray-200 flex flex-col fixed md:static inset-y-0 left-0 z-40 transition-transform ${
          menuOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        }`}
      >
        <div className="px-4 py-5 border-b border-navy-light/40 flex items-center gap-2">
          <img src="/logo.png" alt="" className="h-8 w-8 flex-shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-lg font-bold text-white leading-tight">{t("merchant.appName")}</p>
            <p className="text-xs text-gray-400 truncate">{store?.name ?? merchant?.business_name}</p>
          </div>
          <button onClick={() => setMenuOpen(false)} aria-label={t("nav.closeMenu")} className="md:hidden p-1 flex-shrink-0">
            <X className="w-5 h-5" />
          </button>
        </div>
        <nav className="flex-1 py-3">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `flex items-center gap-3 px-4 py-2 text-sm ${isActive ? "bg-navy text-white" : "text-gray-300 hover:bg-navy"}`
              }
            >
              <item.icon className="w-4 h-4 flex-shrink-0" />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="px-4 py-2 border-t border-navy-light/40">
          <LanguageSwitcher variant="full" className="text-gray-300" />
        </div>
        <button
          onClick={handleSignOut}
          className="flex items-center gap-3 px-4 py-3 text-sm text-left text-gray-300 hover:bg-navy border-t border-navy-light/40"
        >
          <LogOut className="w-4 h-4" />
          {t("common.signOut")}
        </button>
      </aside>

      <main className="flex-1 p-4 pt-20 md:p-6 md:pt-6 max-w-5xl">
        <Outlet />
      </main>
      <NewOrderAlert />
    </div>
  );
}
