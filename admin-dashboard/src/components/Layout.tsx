import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/AuthContext";

const navItems = [
  { to: "/", label: "Dashboard", end: true },
  { to: "/orders", label: "Orders" },
  { to: "/payments", label: "Payments" },
  { to: "/merchants", label: "Merchants" },
  { to: "/products", label: "Products" },
  { to: "/customers", label: "Customers" },
  { to: "/delivery-ops", label: "Delivery Ops" },
  { to: "/pricing-rules", label: "Pricing Rules" },
  { to: "/refunds", label: "Refunds" },
  { to: "/settlements", label: "Settlements" },
  { to: "/inventory-movements", label: "Inventory Movements" },
  { to: "/notification-templates", label: "Notification Templates" },
  { to: "/support", label: "Support" },
  { to: "/users", label: "Users & Roles" },
  { to: "/audit-log", label: "Audit Log" },
  { to: "/settings", label: "Settings" },
];

export function Layout() {
  const { role, signOut } = useAuth();
  const navigate = useNavigate();

  async function handleSignOut() {
    await signOut();
    navigate("/login");
  }

  return (
    <div className="min-h-screen flex">
      <aside className="w-56 bg-navy-dark text-slate-200 flex flex-col">
        <div className="px-4 py-5 border-b border-navy-light/40 flex items-center gap-2">
          <img src="/logo.png" alt="" className="h-8 w-8 flex-shrink-0" />
          <div className="min-w-0">
            <p className="text-lg font-bold text-white leading-tight">Tolo Admin</p>
            <p className="text-xs text-slate-400 capitalize">{role?.replaceAll("_", " ")}</p>
          </div>
        </div>
        <nav className="flex-1 py-3">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `block px-4 py-2 text-sm ${isActive ? "bg-navy text-white" : "text-slate-300 hover:bg-navy"}`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <button onClick={handleSignOut} className="px-4 py-3 text-sm text-left text-slate-300 hover:bg-navy border-t border-navy-light/40">
          Sign out
        </button>
      </aside>
      <main className="flex-1 p-6 max-w-6xl">
        <Outlet />
      </main>
    </div>
  );
}
