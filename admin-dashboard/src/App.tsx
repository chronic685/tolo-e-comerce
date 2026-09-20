import { Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { Login } from "./pages/Login";
import { ForgotPassword } from "./pages/ForgotPassword";
import { ResetPassword } from "./pages/ResetPassword";
import { Dashboard } from "./pages/Dashboard";
import { Merchants } from "./pages/Merchants";
import { Categories } from "./pages/Categories";
import { Products } from "./pages/Products";
import { Customers } from "./pages/Customers";
import { Orders } from "./pages/Orders";
import { Payments } from "./pages/Payments";
import { Commissions } from "./pages/Commissions";
import { Discounts } from "./pages/Discounts";
import { Refunds } from "./pages/Refunds";
import { Users } from "./pages/Users";
import { AuditLog } from "./pages/AuditLog";
import { Settings } from "./pages/Settings";
import { Settlements } from "./pages/Settlements";
import { Support } from "./pages/Support";
import { DeliveryOps } from "./pages/DeliveryOps";
import { NotificationTemplates } from "./pages/NotificationTemplates";
import { InventoryMovements } from "./pages/InventoryMovements";

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<Layout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/merchants" element={<Merchants />} />
          <Route path="/categories" element={<Categories />} />
          <Route path="/products" element={<Products />} />
          <Route path="/customers" element={<Customers />} />
          <Route path="/orders" element={<Orders />} />
          <Route path="/payments" element={<Payments />} />
          <Route path="/delivery-ops" element={<DeliveryOps />} />
          {/* Old standalone routes — kept as redirects in case anything still links to them directly. */}
          <Route path="/deliveries" element={<Navigate to="/delivery-ops" replace />} />
          <Route path="/drivers" element={<Navigate to="/delivery-ops?tab=drivers" replace />} />
          <Route path="/delivery-zones" element={<Navigate to="/delivery-ops?tab=zones" replace />} />
          <Route path="/commissions" element={<Commissions />} />
          <Route path="/discounts" element={<Discounts />} />
          <Route path="/refunds" element={<Refunds />} />
          <Route path="/settlements" element={<Settlements />} />
          <Route path="/inventory-movements" element={<InventoryMovements />} />
          <Route path="/notification-templates" element={<NotificationTemplates />} />
          <Route path="/support" element={<Support />} />
          <Route path="/users" element={<Users />} />
          <Route path="/audit-log" element={<AuditLog />} />
          <Route path="/settings" element={<Settings />} />
        </Route>
      </Route>
    </Routes>
  );
}
