import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { AlertTriangle, Bell, Home, Package, ShoppingCart, Store, User, X } from "lucide-react";
import { LanguageSwitcher, ThemeToggle, useTranslation } from "@tolo/ui";
import { useAuth } from "../lib/AuthContext";
import { useCart } from "../lib/CartContext";
import { supabase } from "../lib/supabase";
import { closeApp, isEmbedMode } from "../lib/appBridge";

export function Layout() {
  const { user } = useAuth();
  const { itemCount } = useCart();
  const { t } = useTranslation();
  const [maintenanceMode, setMaintenanceMode] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const location = useLocation();
  const embed = isEmbedMode();

  const TABS = [
    { to: "/", label: t("nav.home"), icon: Home, end: true },
    { to: "/stores", label: t("nav.shops"), icon: Store },
    { to: "/cart", label: t("nav.cart"), icon: ShoppingCart },
    { to: "/orders", label: t("nav.orders"), icon: Package },
    { to: "/account", label: t("nav.account"), icon: User },
  ];

  useEffect(() => {
    supabase
      .from("system_settings")
      .select("value")
      .eq("key", "platform_maintenance_mode")
      .maybeSingle()
      .then(({ data }) => setMaintenanceMode(Boolean(data?.value)));
  }, []);

  useEffect(() => {
    if (!user) {
      setUnreadCount(0);
      return;
    }
    supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("is_read", false)
      .then(({ count }) => setUnreadCount(count ?? 0));
  }, [user, location.pathname]);

  return (
    <div className="min-h-screen flex flex-col bg-white dark:bg-navy-dark dark:text-gray-100">
      {maintenanceMode && (
        <div className="bg-red-600 text-white text-center text-sm py-2 px-4 flex items-center justify-center gap-2">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          {t("maintenance.banner")}
        </div>
      )}

      {embed && (
        <div className="sticky top-0 z-10 bg-white dark:bg-navy-dark border-b dark:border-white/10 flex items-center justify-end px-4 py-2">
          <button
            type="button"
            onClick={closeApp}
            aria-label={t("common.close")}
            className="text-gray-500 hover:text-navy dark:text-gray-400 dark:hover:text-white p-1"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      )}

      {!embed && (
      <header className="border-b dark:border-white/10 bg-white dark:bg-navy-dark sticky top-0 z-10">
        <div className="max-w-6xl mx-auto flex items-center justify-between px-4 py-3">
          <Link to="/" className="flex items-center gap-2 text-xl font-bold text-navy dark:text-navy-light">
            <img src="/logo.png" alt="" className="h-8 w-8" />
            Tolo
          </Link>

          {/* Desktop nav */}
          <nav className="hidden md:flex items-center gap-5 text-sm">
            <Link to="/" className="hover:text-navy dark:hover:text-navy-light">
              {t("nav.marketplace")}
            </Link>
            <Link to="/stores" className="hover:text-navy dark:hover:text-navy-light">
              {t("nav.shops")}
            </Link>
            {user && (
              <Link to="/orders" className="hover:text-navy dark:hover:text-navy-light">
                {t("nav.myOrders")}
              </Link>
            )}
          </nav>

          {/* Icon actions — visible on every width */}
          <div className="flex items-center gap-4">
            <ThemeToggle className="hidden md:inline-flex text-gray-600 hover:text-navy dark:text-gray-300 dark:hover:text-navy-light" />
            <LanguageSwitcher className="hidden md:inline-flex text-gray-600 hover:text-navy dark:text-gray-300 dark:hover:text-navy-light" />
            {user && (
              <Link to="/notifications" aria-label={t("nav.notifications")} className="relative text-gray-600 hover:text-navy dark:text-gray-300 dark:hover:text-navy-light">
                <Bell className="w-5 h-5" />
                {unreadCount > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 bg-orange-500 text-white text-[10px] leading-none rounded-full min-w-[16px] h-4 flex items-center justify-center px-1">
                    {unreadCount}
                  </span>
                )}
              </Link>
            )}
            <Link to="/cart" aria-label={t("nav.cart")} className="relative text-gray-600 hover:text-navy dark:text-gray-300 dark:hover:text-navy-light">
              <ShoppingCart className="w-5 h-5" />
              {itemCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 bg-navy text-white text-[10px] leading-none rounded-full min-w-[16px] h-4 flex items-center justify-center px-1">
                  {itemCount}
                </span>
              )}
            </Link>
            {user ? (
              <Link to="/account" aria-label={t("nav.account")} className="hidden md:block text-gray-600 hover:text-navy dark:text-gray-300 dark:hover:text-navy-light">
                <User className="w-5 h-5" />
              </Link>
            ) : (
              <Link to="/login" className="text-sm hover:text-navy dark:hover:text-navy-light">
                {t("nav.signIn")}
              </Link>
            )}
          </div>
        </div>
      </header>
      )}

      <main className={`flex-1 max-w-6xl mx-auto w-full px-4 py-6 ${embed ? "" : "pb-24 md:pb-6"}`}>
        <Outlet />
      </main>

      {!embed && (
      <footer className="hidden md:block border-t dark:border-white/10 bg-white dark:bg-navy-dark text-center text-xs text-gray-500 dark:text-gray-400 py-4">
        <p>{t("footer.poweredBy")}</p>
        <nav className="flex items-center justify-center gap-3 mt-1.5">
          <Link to="/legal/terms" className="hover:text-navy dark:hover:text-navy-light hover:underline">
            {t("footer.terms")}
          </Link>
          <span aria-hidden="true">·</span>
          <Link to="/legal/privacy" className="hover:text-navy dark:hover:text-navy-light hover:underline">
            {t("footer.privacy")}
          </Link>
          <span aria-hidden="true">·</span>
          <Link to="/legal/refund-policy" className="hover:text-navy dark:hover:text-navy-light hover:underline">
            {t("footer.refundPolicy")}
          </Link>
        </nav>
      </footer>
      )}

      {/* Bottom tab bar — phones only, hidden in embed mode. This app has no
          slide-out mobile menu (a persistent bottom bar is the whole mobile
          nav), so the language switcher's mobile-menu presence (Group 5,
          item 2) lives on the Account page instead — the natural "settings"
          surface on this bottom-tab-bar layout. */}
      {!embed && (
      <nav
        className="md:hidden fixed bottom-0 inset-x-0 bg-white dark:bg-navy-dark border-t dark:border-white/10 z-10"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      >
        <div className="grid grid-cols-5">
          {TABS.map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              end={tab.end}
              className={({ isActive }) =>
                `flex flex-col items-center justify-center gap-0.5 py-2 text-[11px] relative ${
                  isActive ? "text-navy dark:text-navy-light" : "text-gray-500 dark:text-gray-400"
                }`
              }
            >
              <span className="relative">
                <tab.icon className="w-5 h-5" />
                {tab.to === "/cart" && itemCount > 0 && (
                  <span className="absolute -top-1.5 -right-2 bg-navy text-white text-[9px] leading-none rounded-full min-w-[14px] h-3.5 flex items-center justify-center px-0.5">
                    {itemCount}
                  </span>
                )}
              </span>
              {tab.label}
            </NavLink>
          ))}
        </div>
      </nav>
      )}
    </div>
  );
}
