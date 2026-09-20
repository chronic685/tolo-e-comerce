import { Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { MerchantGate } from "./components/MerchantGate";
import { Login } from "./pages/Login";
import { Signup } from "./pages/Signup";
import { ForgotPassword } from "./pages/ForgotPassword";
import { ResetPassword } from "./pages/ResetPassword";
import { Dashboard } from "./pages/Dashboard";
import { Products } from "./pages/Products";
import { ProductForm } from "./pages/ProductForm";
import { BulkUpload } from "./pages/BulkUpload";
import { Orders } from "./pages/Orders";
import { OrderDetail } from "./pages/OrderDetail";
import { StoreSettings } from "./pages/StoreSettings";
import { Wallet } from "./pages/Wallet";
import { Staff } from "./pages/Staff";

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<Signup />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route element={<MerchantGate />}>
        <Route element={<Layout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/products" element={<Products />} />
          <Route path="/products/:id" element={<ProductForm />} />
          <Route path="/products-bulk-upload" element={<BulkUpload />} />
          <Route path="/orders" element={<Orders />} />
          <Route path="/orders/:id" element={<OrderDetail />} />
          <Route path="/wallet" element={<Wallet />} />
          <Route path="/store" element={<StoreSettings />} />
          <Route path="/staff" element={<Staff />} />
        </Route>
      </Route>
    </Routes>
  );
}
