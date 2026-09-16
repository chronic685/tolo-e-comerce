import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/AuthContext";
import { useMerchant } from "../lib/MerchantContext";
import { NewOrderAlert } from "./NewOrderAlert";

const navItems = [
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

  async function handleSignOut() {
    await signOut();
    navigate("/login");
  }

  return (
    <div className="min-h-screen flex">
      <aside className="w-56 bg-gray-900 text-gray-200 flex flex-col">
        <div className="px-4 py-5 border-b border-gray-800">
          <p className="text-lg font-bold text-white">Tolo Merchant</p>
          <p className="text-xs text-gray-400 truncate">{store?.name ?? merchant?.business_name}</p>
        </div>
        <nav className="flex-1 py-3">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `block px-4 py-2 text-sm ${isActive ? "bg-gray-800 text-white" : "text-gray-300 hover:bg-gray-800"}`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <button onClick={handleSignOut} className="px-4 py-3 text-sm text-left text-gray-300 hover:bg-gray-800 border-t border-gray-800">
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
