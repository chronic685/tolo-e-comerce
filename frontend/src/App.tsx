import { Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { Marketplace } from "./pages/Marketplace";
import { ProductDetail } from "./pages/ProductDetail";
import { Storefront } from "./pages/Storefront";
import { Cart } from "./pages/Cart";
import { Checkout } from "./pages/Checkout";
import { Login } from "./pages/Login";
import { Signup } from "./pages/Signup";
import { ForgotPassword } from "./pages/ForgotPassword";
import { ResetPassword } from "./pages/ResetPassword";
import { Orders } from "./pages/Orders";
import { OrderDetail } from "./pages/OrderDetail";
import { OrderConfirmation } from "./pages/OrderConfirmation";
import { Account } from "./pages/Account";
import { Favorites } from "./pages/Favorites";
import { Notifications } from "./pages/Notifications";
import { Support } from "./pages/Support";
import { SavedLocations } from "./pages/SavedLocations";

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Marketplace />} />
        <Route path="/products/:slug" element={<ProductDetail />} />
        <Route path="/stores/:slug" element={<Storefront />} />
        <Route path="/cart" element={<Cart />} />
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route element={<ProtectedRoute />}>
          <Route path="/checkout" element={<Checkout />} />
          <Route path="/orders" element={<Orders />} />
          <Route path="/orders/:id/confirmation" element={<OrderConfirmation />} />
          <Route path="/orders/:id" element={<OrderDetail />} />
          <Route path="/account" element={<Account />} />
          <Route path="/favorites" element={<Favorites />} />
          <Route path="/notifications" element={<Notifications />} />
          <Route path="/support" element={<Support />} />
          <Route path="/locations" element={<SavedLocations />} />
        </Route>
      </Route>
    </Routes>
  );
}
