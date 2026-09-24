import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/AuthContext";
import { ADMIN_PAGES } from "../lib/adminPages";

export function Layout() {
  const { role, hasAccess, signOut } = useAuth();
  const navigate = useNavigate();
  // Nav only ever shows pages this staff member can actually open (super
  // admins see everything regardless of their own permissions list) — this
  // is a convenience, not the enforcement; PageGuard on each route is what
  // actually stops a direct URL visit.
  const navItems = ADMIN_PAGES.filter((item) => !item.hiddenFromNav && hasAccess(item.key));

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
