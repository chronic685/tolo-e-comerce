import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle } from "lucide-react";
import { supabase } from "../lib/supabase";
import { SkeletonPage, useTranslation } from "@tolo/ui";
import { SalesTrend } from "../components/SalesTrend";
import { LiveOrdersFeed } from "../components/LiveOrdersFeed";

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
  const { t } = useTranslation();
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

  if (!stats) return <SkeletonPage />;

  return (
    <div>
      <h1 className="text-xl font-bold mb-1 dark:text-gray-100">{t("adminDashboard.title")}</h1>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">{t("adminDashboard.subtitle")}</p>

      {stats.unacknowledgedOrders > 0 && (
        <Link
          to="/orders?filter=unacknowledged"
          className="flex items-center gap-2 bg-red-50 border border-red-300 text-red-800 rounded-lg p-4 mb-3 text-sm font-bold hover:bg-red-100"
        >
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          {t("adminDashboard.unacknowledgedOrdersAlert", { count: stats.unacknowledgedOrders })}
        </Link>
      )}
      {stats.pendingMerchants > 0 && (
        <Link
          to="/merchants?status=registered"
          className="flex items-center gap-2 bg-yellow-50 border border-yellow-300 text-yellow-800 rounded-lg p-4 mb-3 text-sm font-medium hover:bg-yellow-100"
        >
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          {t("adminDashboard.pendingMerchantsAlert", { count: stats.pendingMerchants })}
        </Link>
      )}
      {stats.openTickets > 0 && (
        <Link
          to="/support"
          className="flex items-center gap-2 bg-blue-50 border border-blue-300 text-blue-800 rounded-lg p-4 mb-6 text-sm font-medium hover:bg-blue-100"
        >
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          {t("adminDashboard.openTicketsAlert", { count: stats.openTickets })}
        </Link>
      )}

      <LiveOrdersFeed />
      <SalesTrend />

      <DashboardSection title={t("adminDashboard.sections.customers")}>
        <StatCard label={t("adminDashboard.stat.registered")} value={stats.registeredCustomers} />
        <StatCard label={t("adminDashboard.stat.active30d")} value={stats.activeCustomers} hint={t("adminDashboard.stat.activeHint")} />
        <StatCard label={t("adminDashboard.stat.new7d")} value={stats.newCustomers} />
      </DashboardSection>

      <DashboardSection title={t("adminDashboard.sections.merchants")}>
        <StatCard label={t("adminDashboard.stat.total")} value={stats.totalMerchants} />
        <StatCard label={t("adminDashboard.stat.approved")} value={stats.approvedMerchants} />
        <StatCard label={t("adminDashboard.stat.pendingVerification")} value={stats.pendingMerchants} highlight={stats.pendingMerchants > 0} />
        <StatCard label={t("adminDashboard.stat.suspended")} value={stats.suspendedMerchants} />
      </DashboardSection>

      <DashboardSection title={t("adminDashboard.sections.products")}>
        <StatCard label={t("adminDashboard.stat.total")} value={stats.totalProducts} />
        <StatCard label={t("adminDashboard.stat.published")} value={stats.publishedProducts} />
        <StatCard label={t("adminDashboard.stat.outOfStockVariants")} value={stats.outOfStockVariants} />
        <StatCard label={t("adminDashboard.stat.pendingApproval")} value={stats.pendingApprovalProducts} highlight={stats.pendingApprovalProducts > 0} />
      </DashboardSection>

      <DashboardSection title={t("adminDashboard.sections.orders")}>
        <StatCard label={t("adminDashboard.stat.total")} value={stats.totalOrders} />
        <StatCard label={t("adminDashboard.stat.new")} value={stats.newOrders} highlight={stats.newOrders > 0} />
        <StatCard label={t("adminDashboard.stat.preparing")} value={stats.preparingOrders} />
        <StatCard label={t("adminDashboard.stat.readyForPickup")} value={stats.readyForPickupOrders} />
        <StatCard label={t("adminDashboard.stat.inDelivery")} value={stats.inDeliveryOrders} />
        <StatCard label={t("adminDashboard.stat.completed")} value={stats.completedOrders} />
        <StatCard label={t("adminDashboard.stat.cancelled")} value={stats.cancelledOrders} />
      </DashboardSection>

      <DashboardSection title={t("adminDashboard.sections.sales")}>
        <StatCard label={t("adminDashboard.gmv")} value={`${stats.gmv.toFixed(2)} ETB`} hint={t("adminDashboard.stat.gmvHint")} />
        <StatCard label={t("adminDashboard.stat.merchantSales")} value={`${stats.merchantSales.toFixed(2)} ETB`} hint={t("adminDashboard.stat.merchantSalesHint")} />
        <StatCard label={t("adminDashboard.stat.toloCommission")} value={`${stats.commissionEarned.toFixed(2)} ETB`} />
        <StatCard label={t("adminDashboard.stat.discountsGiven")} value={`${stats.discountsGiven.toFixed(2)} ETB`} />
        <StatCard label={t("adminDashboard.stat.refundsIssued")} value={`${stats.refundsIssued.toFixed(2)} ETB`} />
        <StatCard
          label={t("adminDashboard.stat.netPlatformRevenue")}
          value={`${(stats.commissionEarned - stats.refundsIssued).toFixed(2)} ETB`}
          hint={t("adminDashboard.stat.netPlatformRevenueHint")}
        />
      </DashboardSection>
    </div>
  );
}

function DashboardSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-6">
      <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">{title}</h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">{children}</div>
    </div>
  );
}

function StatCard({ label, value, highlight, hint }: { label: string; value: string | number; highlight?: boolean; hint?: string }) {
  return (
    <div className={`bg-white dark:bg-navy-dark border dark:border-white/10 rounded-lg p-4 ${highlight ? "border-navy dark:border-navy-light" : ""}`} title={hint}>
      <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
      <p className="text-2xl font-bold mt-1 dark:text-gray-100">{value}</p>
      {hint && <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">{hint}</p>}
    </div>
  );
}
