import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { AlertTriangle, Bell, Home, Package, ShoppingCart, Store, User } from "lucide-react";
import { useAuth } from "../lib/AuthContext";
import { useCart } from "../lib/CartContext";
import { supabase } from "../lib/supabase";

const TABS = [
  { to: "/", label: "Home", icon: Home, end: true },
  { to: "/stores", label: "Shops", icon: Store },
  { to: "/cart", label: "Cart", icon: ShoppingCart },
  { to: "/orders", label: "Orders", icon: Package },
  { to: "/account", label: "Account", icon: User },
];

export function Layout() {
  const { user } = useAuth();
  const { itemCount } = useCart();
  const [maintenanceMode, setMaintenanceMode] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const location = useLocation();

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
    <div className="min-h-screen flex flex-col">
      {maintenanceMode && (
        <div className="bg-red-600 text-white text-center text-sm py-2 px-4 flex items-center justify-center gap-2">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          Tolo is temporarily under maintenance — placing new orders is paused. Browsing still works.
        </div>
      )}

      <header className="border-b bg-white sticky top-0 z-10">
        <div className="max-w-6xl mx-auto flex items-center justify-between px-4 py-3">
          <Link to="/" className="flex items-center gap-2 text-xl font-bold text-navy">
            <img src="/logo.png" alt="" className="h-8 w-8" />
            Tolo
          </Link>

          {/* Desktop nav */}
          <nav className="hidden md:flex items-center gap-5 text-sm">
            <Link to="/" className="hover:text-navy">
              Marketplace
            </Link>
            <Link to="/stores" className="hover:text-navy">
              Shops
            </Link>
            {user && (
              <Link to="/orders" className="hover:text-navy">
                My Orders
              </Link>
            )}
          </nav>

          {/* Icon actions — visible on every width */}
          <div className="flex items-center gap-4">
            {user && (
              <Link to="/notifications" aria-label="Notifications" className="relative text-gray-600 hover:text-navy">
                <Bell className="w-5 h-5" />
                {unreadCount > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 bg-orange-500 text-white text-[10px] leading-none rounded-full min-w-[16px] h-4 flex items-center justify-center px-1">
                    {unreadCount}
                  </span>
                )}
              </Link>
            )}
            <Link to="/cart" aria-label="Cart" className="relative text-gray-600 hover:text-navy">
              <ShoppingCart className="w-5 h-5" />
              {itemCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 bg-navy text-white text-[10px] leading-none rounded-full min-w-[16px] h-4 flex items-center justify-center px-1">
                  {itemCount}
                </span>
              )}
            </Link>
            {user ? (
              <Link to="/account" aria-label="Account" className="hidden md:block text-gray-600 hover:text-navy">
                <User className="w-5 h-5" />
              </Link>
            ) : (
              <Link to="/login" className="text-sm hover:text-navy">
                Sign in
              </Link>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-6xl mx-auto w-full px-4 py-6 pb-24 md:pb-6">
        <Outlet />
      </main>

      <footer className="hidden md:block border-t bg-white text-center text-xs text-gray-500 py-4">
        Tolo Marketplace — powered by Tech City PLC
      </footer>

      {/* Bottom tab bar — phones only */}
      <nav
        className="md:hidden fixed bottom-0 inset-x-0 bg-white border-t z-10"
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
                  isActive ? "text-navy" : "text-gray-500"
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
    </div>
  );
}
