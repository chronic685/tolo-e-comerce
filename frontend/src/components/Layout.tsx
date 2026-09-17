import { useEffect, useState } from "react";
import { Link, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/AuthContext";
import { useCart } from "../lib/CartContext";
import { useFavorites } from "../lib/FavoritesContext";
import { supabase } from "../lib/supabase";

export function Layout() {
  const { user, signOut } = useAuth();
  const { itemCount } = useCart();
  const { enabled: favoritesEnabled } = useFavorites();
  const navigate = useNavigate();
  const [maintenanceMode, setMaintenanceMode] = useState(false);

  useEffect(() => {
    supabase
      .from("system_settings")
      .select("value")
      .eq("key", "platform_maintenance_mode")
      .maybeSingle()
      .then(({ data }) => setMaintenanceMode(Boolean(data?.value)));
  }, []);

  async function handleSignOut() {
    await signOut();
    navigate("/");
  }

  return (
    <div className="min-h-screen flex flex-col">
      {maintenanceMode && (
        <div className="bg-red-600 text-white text-center text-sm py-2 px-4">
          ⚠ Tolo is temporarily under maintenance — placing new orders is paused. Browsing still works.
        </div>
      )}
      <header className="border-b bg-white sticky top-0 z-10">
        <div className="max-w-6xl mx-auto flex items-center justify-between px-4 py-3">
          <Link to="/" className="flex items-center gap-2 text-xl font-bold text-navy">
            <img src="/logo.png" alt="" className="h-8 w-8" />
            Tolo
          </Link>
          <nav className="flex items-center gap-5 text-sm">
            <Link to="/" className="hover:text-navy">
              Marketplace
            </Link>
            {user && (
              <>
                <Link to="/orders" className="hover:text-navy">
                  My Orders
                </Link>
                <Link to="/account" className="hover:text-navy">
                  Account
                </Link>
                {favoritesEnabled && (
                  <Link to="/favorites" className="hover:text-navy">
                    Favorites
                  </Link>
                )}
              </>
            )}
            <Link to="/cart" className="hover:text-navy relative">
              Cart
              {itemCount > 0 && (
                <span className="absolute -top-2 -right-3 bg-navy text-white text-xs rounded-full px-1.5">
                  {itemCount}
                </span>
              )}
            </Link>
            {user ? (
              <button onClick={handleSignOut} className="hover:text-navy">
                Sign out
              </button>
            ) : (
              <Link to="/login" className="hover:text-navy">
                Sign in
              </Link>
            )}
          </nav>
        </div>
      </header>
      <main className="flex-1 max-w-6xl mx-auto w-full px-4 py-6">
        <Outlet />
      </main>
      <footer className="border-t bg-white text-center text-xs text-gray-500 py-4">
        Tolo Marketplace — powered by Tech City PLC
      </footer>
    </div>
  );
}
