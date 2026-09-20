import { useEffect, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/AuthContext";
import { useMerchant } from "../lib/MerchantContext";
import { NewOrderAlert } from "./NewOrderAlert";

const BASE_NAV_ITEMS = [
  { to: "/", label: "Dashboard", end: true },
  { to: "/products", label: "Products" },
  { to: "/orders", label: "Orders" },
  { to: "/wallet", label: "Wallet" },
  { to: "/store", label: "Store Settings" },
];

export function Layout() {
  const { signOut } = useAuth();
  const { merchant, store } = useMerchant();
  const navigate = useNavigate();
  const [staffAccountsEnabled, setStaffAccountsEnabled] = useState(false);

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

  const navItems = staffAccountsEnabled
    ? [...BASE_NAV_ITEMS, { to: "/staff", label: "Staff", end: undefined }]
    : BASE_NAV_ITEMS;

  async function handleSignOut() {
    await signOut();
    navigate("/login");
  }

  return (
    <div className="min-h-screen flex">
      <aside className="w-56 bg-navy-dark text-gray-200 flex flex-col">
        <div className="px-4 py-5 border-b border-navy-light/40 flex items-center gap-2">
          <img src="/logo.png" alt="" className="h-8 w-8 flex-shrink-0" />
          <div className="min-w-0">
            <p className="text-lg font-bold text-white leading-tight">Tolo Merchant</p>
            <p className="text-xs text-gray-400 truncate">{store?.name ?? merchant?.business_name}</p>
          </div>
        </div>
        <nav className="flex-1 py-3">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `block px-4 py-2 text-sm ${isActive ? "bg-navy text-white" : "text-gray-300 hover:bg-navy"}`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <button onClick={handleSignOut} className="px-4 py-3 text-sm text-left text-gray-300 hover:bg-navy border-t border-navy-light/40">
          Sign out
        </button>
      </aside>
      <main className="flex-1 p-6 max-w-5xl">
        <Outlet />
      </main>
      <NewOrderAlert />
    </div>
  );
}
