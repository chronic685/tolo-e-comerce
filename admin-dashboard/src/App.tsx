import { Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { Login } from "./pages/Login";
import { Dashboard } from "./pages/Dashboard";
import { Merchants } from "./pages/Merchants";
import { Categories } from "./pages/Categories";
import { Orders } from "./pages/Orders";
import { Commissions } from "./pages/Commissions";
import { Settlements } from "./pages/Settlements";
import { Support } from "./pages/Support";

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<Layout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/merchants" element={<Merchants />} />
          <Route path="/categories" element={<Categories />} />
          <Route path="/orders" element={<Orders />} />
          <Route path="/commissions" element={<Commissions />} />
          <Route path="/settlements" element={<Settlements />} />
          <Route path="/support" element={<Support />} />
        </Route>
      </Route>
    </Routes>
  );
}
