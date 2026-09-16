import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/AuthContext";

const navItems = [
  { to: "/", label: "Dashboard", end: true },
  { to: "/merchants", label: "Merchants" },
  { to: "/categories", label: "Categories" },
  { to: "/orders", label: "Orders" },
  { to: "/deliveries", label: "Deliveries" },
  { to: "/drivers", label: "Drivers" },
  { to: "/commissions", label: "Commissions" },
  { to: "/settlements", label: "Settlements" },
  { to: "/support", label: "Support" },
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
      <aside className="w-56 bg-slate-900 text-slate-200 flex flex-col">
        <div className="px-4 py-5 border-b border-slate-800">
          <p className="text-lg font-bold text-white">Tolo Admin</p>
          <p className="text-xs text-slate-400 capitalize">{role?.replace("_", " ")}</p>
        </div>
        <nav className="flex-1 py-3">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `block px-4 py-2 text-sm ${isActive ? "bg-slate-800 text-white" : "text-slate-300 hover:bg-slate-800"}`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <button onClick={handleSignOut} className="px-4 py-3 text-sm text-left text-slate-300 hover:bg-slate-800 border-t border-slate-800">
          Sign out
        </button>
      </aside>
      <main className="flex-1 p-6 max-w-6xl">
        <Outlet />
      </main>
    </div>
  );
}
