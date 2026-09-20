import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";

interface Stats {
  // Customers
  registeredCustomers: number;
  newCustomers: number;
  activeCustomers: number;
  // Merchants
  totalMerchants: number;
  approvedMerchants: number;
  pendingMerchants: number;
  suspendedMerchants: number;
  // Products
  totalProducts: number;
  publishedProducts: number;
  outOfStockVariants: number;
  pendingApprovalProducts: number;
  // Orders
  totalOrders: number;
  newOrders: number;
  preparingOrders: number;
  readyForPickupOrders: number;
  inDeliveryOrders: number;
  completedOrders: number;
  cancelledOrders: number;
  // Sales
  gmv: number;
  merchantSales: number;
  commissionEarned: number;
  discountsGiven: number;
  refundsIssued: number;
  // Alerts
  openTickets: number;
  unacknowledgedOrders: number;
}

const SEVEN_DAYS_AGO = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
const THIRTY_DAYS_AGO = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

export function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    async function load() {
      // Same field escalate_unacknowledged_orders() reads (migration 0033)
      // and the only one an admin can actually edit (Settings.tsx,
      // "Escalate to Tolo ops after (minutes)") — the banner's threshold
      // must agree with it, not the old, orphaned, unwritable
      // unacknowledged_order_escalation_minutes key.
      const { data: settingRow } = await supabase
        .from("system_settings")
        .select("value")
        .eq("key", "merchant_new_order_alerts")
        .maybeSingle();
      const alertSettings = settingRow?.value as { escalate_after_minutes?: number } | null;
      const thresholdMinutes = alertSettings?.escalate_after_minutes ?? 5;
      const cutoff = new Date(Date.now() - thresholdMinutes * 60_000).toISOString();

      const [
        { count: registeredCustomers },
        { count: newCustomers },
        { data: activeCustomerOrders },
        { count: totalMerchants },
        { count: approvedMerchants },
        { count: pendingMerchants },
        { count: suspendedMerchants },
        { count: totalProducts },
        { count: publishedProducts },
        { count: outOfStockVariants },
        { count: pendingApprovalProducts },
        { count: totalOrders },
        { data: statusCounts },
        { data: paidOrders },
        { data: paidMerchantOrders },
        { data: completedRefunds },
        { count: openTickets },
        { count: unacknowledgedOrders },
      ] = await Promise.all([
        supabase.from("profiles").select("id", { count: "exact", head: true }).eq("role", "customer"),
        supabase.from("profiles").select("id", { count: "exact", head: true }).eq("role", "customer").gte("created_at", SEVEN_DAYS_AGO),
        supabase.from("orders").select("customer_id").gte("created_at", THIRTY_DAYS_AGO),
        supabase.from("merchants").select("id", { count: "exact", head: true }),
        supabase.from("merchants").select("id", { count: "exact", head: true }).eq("status", "active"),
        supabase.from("merchants").select("id", { count: "exact", head: true }).in("status", ["registered", "pending_verification", "under_review"]),
        supabase.from("merchants").select("id", { count: "exact", head: true }).eq("status", "suspended"),
        supabase.from("products").select("id", { count: "exact", head: true }),
        supabase.from("products").select("id", { count: "exact", head: true }).eq("status", "published"),
        supabase.from("inventory").select("variant_id", { count: "exact", head: true }).lte("available_quantity", 0),
        supabase.from("products").select("id", { count: "exact", head: true }).eq("status", "submitted"),
        supabase.from("orders").select("id", { count: "exact", head: true }),
        supabase.from("merchant_orders").select("status"),
        supabase.from("orders").select("total, discount_amount").eq("payment_status", "paid"),
        supabase.from("merchant_orders").select("merchant_subtotal, merchant_payable, commission_amount, orders!inner(payment_status)").eq("orders.payment_status", "paid"),
        supabase.from("refunds").select("amount").eq("status", "completed"),
        supabase.from("support_tickets").select("id", { count: "exact", head: true }).eq("status", "open"),
        supabase
          .from("merchant_orders")
          .select("id", { count: "exact", head: true })
          .eq("status", "new")
          .not("notification_sent_at", "is", null)
          .lt("notification_sent_at", cutoff),
      ]);

      const activeCustomers = new Set((activeCustomerOrders ?? []).map((o) => o.customer_id)).size;

      const countByStatus = (statuses: string[]) =>
        (statusCounts ?? []).filter((r) => statuses.includes(r.status)).length;

      const gmv = (paidOrders ?? []).reduce((sum, o) => sum + Number(o.total), 0);
      const discountsGiven = (paidOrders ?? []).reduce((sum, o) => sum + Number(o.discount_amount ?? 0), 0);
      const merchantSales = (paidMerchantOrders ?? []).reduce((sum, mo) => sum + Number(mo.merchant_subtotal ?? mo.merchant_payable), 0);
      const commissionEarned = (paidMerchantOrders ?? []).reduce((sum, mo) => sum + Number(mo.commission_amount), 0);
      const refundsIssued = (completedRefunds ?? []).reduce((sum, r) => sum + Number(r.amount), 0);

      setStats({
        registeredCustomers: registeredCustomers ?? 0,
        newCustomers: newCustomers ?? 0,
        activeCustomers,
        totalMerchants: totalMerchants ?? 0,
        approvedMerchants: approvedMerchants ?? 0,
        pendingMerchants: pendingMerchants ?? 0,
        suspendedMerchants: suspendedMerchants ?? 0,
        totalProducts: totalProducts ?? 0,
        publishedProducts: publishedProducts ?? 0,
        outOfStockVariants: outOfStockVariants ?? 0,
        pendingApprovalProducts: pendingApprovalProducts ?? 0,
        totalOrders: totalOrders ?? 0,
        newOrders: countByStatus(["new"]),
        preparingOrders: countByStatus(["accepted", "processing"]),
        readyForPickupOrders: countByStatus(["ready_for_pickup"]),
        inDeliveryOrders: countByStatus(["picked_up"]),
        completedOrders: countByStatus(["completed", "delivered"]),
        cancelledOrders: countByStatus(["cancelled", "rejected"]),
        gmv,
        merchantSales,
        commissionEarned,
        discountsGiven,
        refundsIssued,
        openTickets: openTickets ?? 0,
        unacknowledgedOrders: unacknowledgedOrders ?? 0,
      });
    }
    load();
  }, []);

  if (!stats) return <p className="text-gray-500">Loading...</p>;

  return (
    <div>
      <h1 className="text-xl font-bold mb-1">Platform Overview</h1>
      <p className="text-sm text-gray-500 mb-6">Tolo marketplace at a glance.</p>

      {stats.unacknowledgedOrders > 0 && (
        <Link
          to="/orders?filter=unacknowledged"
          className="block bg-red-50 border border-red-300 text-red-800 rounded-lg p-4 mb-3 text-sm font-bold hover:bg-red-100"
        >
          ⚠ {stats.unacknowledgedOrders} order(s) not acknowledged by their merchant — customer may be waiting →
        </Link>
      )}
      {stats.pendingMerchants > 0 && (
        <Link
          to="/merchants?status=registered"
          className="block bg-yellow-50 border border-yellow-300 text-yellow-800 rounded-lg p-4 mb-3 text-sm font-medium hover:bg-yellow-100"
        >
          {stats.pendingMerchants} merchant application(s) awaiting review →
        </Link>
      )}
      {stats.openTickets > 0 && (
        <Link
          to="/support"
          className="block bg-blue-50 border border-blue-300 text-blue-800 rounded-lg p-4 mb-6 text-sm font-medium hover:bg-blue-100"
        >
          {stats.openTickets} open support ticket(s) →
        </Link>
      )}

      <DashboardSection title="Customers">
        <StatCard label="Registered" value={stats.registeredCustomers} />
        <StatCard label="Active (30d)" value={stats.activeCustomers} hint="Placed at least one order in the last 30 days" />
        <StatCard label="New (7d)" value={stats.newCustomers} />
      </DashboardSection>

      <DashboardSection title="Merchants">
        <StatCard label="Total" value={stats.totalMerchants} />
        <StatCard label="Approved" value={stats.approvedMerchants} />
        <StatCard label="Pending Verification" value={stats.pendingMerchants} highlight={stats.pendingMerchants > 0} />
        <StatCard label="Suspended" value={stats.suspendedMerchants} />
      </DashboardSection>

      <DashboardSection title="Products">
        <StatCard label="Total" value={stats.totalProducts} />
        <StatCard label="Published" value={stats.publishedProducts} />
        <StatCard label="Out of Stock (variants)" value={stats.outOfStockVariants} />
        <StatCard label="Pending Approval" value={stats.pendingApprovalProducts} highlight={stats.pendingApprovalProducts > 0} />
      </DashboardSection>

      <DashboardSection title="Orders">
        <StatCard label="Total" value={stats.totalOrders} />
        <StatCard label="New" value={stats.newOrders} highlight={stats.newOrders > 0} />
        <StatCard label="Preparing" value={stats.preparingOrders} />
        <StatCard label="Ready for Pickup" value={stats.readyForPickupOrders} />
        <StatCard label="In Delivery" value={stats.inDeliveryOrders} />
        <StatCard label="Completed" value={stats.completedOrders} />
        <StatCard label="Cancelled" value={stats.cancelledOrders} />
      </DashboardSection>

      <DashboardSection title="Sales (paid orders)">
        <StatCard label="GMV" value={`${stats.gmv.toFixed(2)} ETB`} hint="Total customer payments on paid orders" />
        <StatCard label="Merchant Sales" value={`${stats.merchantSales.toFixed(2)} ETB`} hint="What merchants are owed before Tolo's cut" />
        <StatCard label="Tolo Commission" value={`${stats.commissionEarned.toFixed(2)} ETB`} />
        <StatCard label="Discounts Given" value={`${stats.discountsGiven.toFixed(2)} ETB`} />
        <StatCard label="Refunds Issued" value={`${stats.refundsIssued.toFixed(2)} ETB`} />
        <StatCard
          label="Net Platform Revenue"
          value={`${(stats.commissionEarned - stats.refundsIssued).toFixed(2)} ETB`}
          hint="Commission earned minus refunds issued"
        />
      </DashboardSection>
    </div>
  );
}

function DashboardSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-6">
      <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">{title}</h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">{children}</div>
    </div>
  );
}

function StatCard({ label, value, highlight, hint }: { label: string; value: string | number; highlight?: boolean; hint?: string }) {
  return (
    <div className={`bg-white border rounded-lg p-4 ${highlight ? "border-navy" : ""}`} title={hint}>
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-2xl font-bold mt-1">{value}</p>
      {hint && <p className="text-[11px] text-gray-400 mt-1">{hint}</p>}
    </div>
  );
}
