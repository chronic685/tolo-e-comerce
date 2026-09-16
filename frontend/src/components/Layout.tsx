import { Link, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/AuthContext";
import { useCart } from "../lib/CartContext";

export function Layout() {
  const { user, signOut } = useAuth();
  const { itemCount } = useCart();
  const navigate = useNavigate();

  async function handleSignOut() {
    await signOut();
    navigate("/");
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b bg-white sticky top-0 z-10">
        <div className="max-w-6xl mx-auto flex items-center justify-between px-4 py-3">
          <Link to="/" className="text-xl font-bold text-emerald-700">
            Tolo
          </Link>
          <nav className="flex items-center gap-5 text-sm">
            <Link to="/" className="hover:text-emerald-700">
              Marketplace
            </Link>
            {user && (
              <Link to="/orders" className="hover:text-emerald-700">
                My Orders
              </Link>
            )}
            <Link to="/cart" className="hover:text-emerald-700 relative">
              Cart
              {itemCount > 0 && (
                <span className="absolute -top-2 -right-3 bg-emerald-600 text-white text-xs rounded-full px-1.5">
                  {itemCount}
                </span>
              )}
            </Link>
            {user ? (
              <button onClick={handleSignOut} className="hover:text-emerald-700">
                Sign out
              </button>
            ) : (
              <Link to="/login" className="hover:text-emerald-700">
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
