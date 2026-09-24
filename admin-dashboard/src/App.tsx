import { Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { PageGuard } from "./components/PageGuard";
import { Login } from "./pages/Login";
import { ForgotPassword } from "./pages/ForgotPassword";
import { ResetPassword } from "./pages/ResetPassword";
import { Dashboard } from "./pages/Dashboard";
import { Merchants } from "./pages/Merchants";
import { Products } from "./pages/Products";
import { Customers } from "./pages/Customers";
import { Orders } from "./pages/Orders";
import { Payments } from "./pages/Payments";
import { PricingRules } from "./pages/PricingRules";
import { Refunds } from "./pages/Refunds";
import { Users } from "./pages/Users";
import { AuditLog } from "./pages/AuditLog";
import { Settings } from "./pages/Settings";
import { Settlements } from "./pages/Settlements";
import { Support } from "./pages/Support";
import { DeliveryOps } from "./pages/DeliveryOps";
import { NotificationTemplates } from "./pages/NotificationTemplates";
import { InventoryMovements } from "./pages/InventoryMovements";
import { ChangePassword } from "./pages/ChangePassword";

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<Layout />}>
          {/* Every signed-in account, whatever its page checklist -- not a PageGuard page. */}
          <Route path="/account/password" element={<ChangePassword />} />
          <Route
            path="/"
            element={
              <PageGuard pageKey="dashboard">
                <Dashboard />
              </PageGuard>
            }
          />
          <Route
            path="/merchants"
            element={
              <PageGuard pageKey="merchants">
                <Merchants />
              </PageGuard>
            }
          />
          <Route
            path="/products"
            element={
              <PageGuard pageKey="products">
                <Products />
              </PageGuard>
            }
          />
          {/* Categories folded into the Products page as a tab — gated the
              same as /products itself, since that's where it actually lands. */}
          <Route path="/categories" element={<Navigate to="/products?tab=categories" replace />} />
          <Route
            path="/customers"
            element={
              <PageGuard pageKey="customers">
                <Customers />
              </PageGuard>
            }
          />
          <Route
            path="/orders"
            element={
              <PageGuard pageKey="orders">
                <Orders />
              </PageGuard>
            }
          />
          <Route
            path="/payments"
            element={
              <PageGuard pageKey="payments">
                <Payments />
              </PageGuard>
            }
          />
          <Route
            path="/delivery-ops"
            element={
              <PageGuard pageKey="delivery_ops">
                <DeliveryOps />
              </PageGuard>
            }
          />
          {/* Old standalone routes — kept as redirects in case anything still links to them directly. */}
          <Route path="/deliveries" element={<Navigate to="/delivery-ops" replace />} />
          <Route path="/drivers" element={<Navigate to="/delivery-ops?tab=drivers" replace />} />
          <Route path="/delivery-zones" element={<Navigate to="/delivery-ops?tab=zones" replace />} />
          <Route
            path="/pricing-rules"
            element={
              <PageGuard pageKey="pricing_rules">
                <PricingRules />
              </PageGuard>
            }
          />
          {/* Old standalone routes — kept as redirects in case anything still links to them directly. */}
          <Route path="/commissions" element={<Navigate to="/pricing-rules?tab=commissions" replace />} />
          <Route path="/discounts" element={<Navigate to="/pricing-rules" replace />} />
          <Route
            path="/refunds"
            element={
              <PageGuard pageKey="refunds">
                <Refunds />
              </PageGuard>
            }
          />
          <Route
            path="/settlements"
            element={
              <PageGuard pageKey="settlements">
                <Settlements />
              </PageGuard>
            }
          />
          <Route
            path="/inventory-movements"
            element={
              <PageGuard pageKey="inventory_movements">
                <InventoryMovements />
              </PageGuard>
            }
          />
          <Route
            path="/notification-templates"
            element={
              <PageGuard pageKey="notification_templates">
                <NotificationTemplates />
              </PageGuard>
            }
          />
          <Route
            path="/support"
            element={
              <PageGuard pageKey="support">
                <Support />
              </PageGuard>
            }
          />
          <Route
            path="/users"
            element={
              <PageGuard pageKey="users">
                <Users />
              </PageGuard>
            }
          />
          <Route
            path="/audit-log"
            element={
              <PageGuard pageKey="audit_log">
                <AuditLog />
              </PageGuard>
            }
          />
          <Route
            path="/settings"
            element={
              <PageGuard pageKey="settings">
                <Settings />
              </PageGuard>
            }
          />
        </Route>
      </Route>
    </Routes>
  );
}
