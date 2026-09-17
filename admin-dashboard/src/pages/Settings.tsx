import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

interface PaymentMethods {
  cash_on_delivery: boolean;
  bank_transfer: boolean;
  mobile_money: boolean;
}

interface DeliverySettings {
  enabled: boolean;
  base_fee: number;
  free_delivery_threshold: number | null;
  max_delivery_distance_km: number | null;
}

interface CustomerFeatures {
  reviews_enabled: boolean;
  wallet_enabled: boolean;
  referrals_enabled: boolean;
  guest_browsing_enabled: boolean;
  favorites_enabled: boolean;
  scheduled_orders_enabled: boolean;
  order_cancellation_enabled: boolean;
  promo_codes_enabled: boolean;
}

interface MerchantFeatures {
  self_registration_enabled: boolean;
  auto_publish_products: boolean;
  bulk_upload_enabled: boolean;
  staff_accounts_enabled: boolean;
  multiple_branches_enabled: boolean;
  settlement_requests_enabled: boolean;
}

interface NewOrderAlertSettings {
  vibrate: boolean;
  reminder_interval_minutes: number;
  escalate_after_minutes: number;
}

interface NotificationChannels {
  push: boolean;
  sms: boolean;
  email: boolean;
  in_app: boolean;
}

const DEFAULTS = {
  payment_methods: { cash_on_delivery: true, bank_transfer: true, mobile_money: true } satisfies PaymentMethods,
  delivery: { enabled: true, base_fee: 0, free_delivery_threshold: null, max_delivery_distance_km: null } satisfies DeliverySettings,
  customer_features: {
    reviews_enabled: true,
    wallet_enabled: false,
    referrals_enabled: false,
    guest_browsing_enabled: true,
    favorites_enabled: true,
    scheduled_orders_enabled: false,
    order_cancellation_enabled: true,
    promo_codes_enabled: true,
  } satisfies CustomerFeatures,
  merchant_features: {
    self_registration_enabled: true,
    auto_publish_products: false,
    bulk_upload_enabled: false,
    staff_accounts_enabled: true,
    multiple_branches_enabled: false,
    settlement_requests_enabled: true,
  } satisfies MerchantFeatures,
  merchant_new_order_alerts: {
    vibrate: true,
    reminder_interval_minutes: 2,
    escalate_after_minutes: 5,
  } satisfies NewOrderAlertSettings,
  notification_channels: { push: true, sms: true, email: true, in_app: true } satisfies NotificationChannels,
};

export function Settings() {
  const [maintenanceMode, setMaintenanceMode] = useState(false);
  const [productPublicationMode, setProductPublicationMode] = useState("approval_required");
  const [minOrderValue, setMinOrderValue] = useState("0");
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethods>(DEFAULTS.payment_methods);
  const [delivery, setDelivery] = useState<DeliverySettings>(DEFAULTS.delivery);
  const [customerFeatures, setCustomerFeatures] = useState<CustomerFeatures>(DEFAULTS.customer_features);
  const [merchantFeatures, setMerchantFeatures] = useState<MerchantFeatures>(DEFAULTS.merchant_features);
  const [newOrderAlerts, setNewOrderAlerts] = useState<NewOrderAlertSettings>(DEFAULTS.merchant_new_order_alerts);
  const [notificationChannels, setNotificationChannels] = useState<NotificationChannels>(DEFAULTS.notification_channels);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    supabase
      .from("system_settings")
      .select("key, value")
      .in("key", [
        "platform_maintenance_mode",
        "product_publication_mode",
        "min_order_value",
        "payment_methods",
        "delivery",
        "customer_features",
        "merchant_features",
        "merchant_new_order_alerts",
        "notification_channels",
      ])
      .then(({ data }) => {
        for (const row of data ?? []) {
          switch (row.key) {
            case "platform_maintenance_mode":
              setMaintenanceMode(Boolean(row.value));
              break;
            case "product_publication_mode":
              setProductPublicationMode(row.value as string);
              break;
            case "min_order_value":
              setMinOrderValue(String(row.value));
              break;
            case "payment_methods":
              setPaymentMethods({ ...DEFAULTS.payment_methods, ...(row.value as object) });
              break;
            case "delivery":
              setDelivery({ ...DEFAULTS.delivery, ...(row.value as object) });
              break;
            case "customer_features":
              setCustomerFeatures({ ...DEFAULTS.customer_features, ...(row.value as object) });
              break;
            case "merchant_features":
              setMerchantFeatures({ ...DEFAULTS.merchant_features, ...(row.value as object) });
              break;
            case "merchant_new_order_alerts":
              setNewOrderAlerts({ ...DEFAULTS.merchant_new_order_alerts, ...(row.value as object) });
              break;
            case "notification_channels":
              setNotificationChannels({ ...DEFAULTS.notification_channels, ...(row.value as object) });
              break;
          }
        }
        setLoading(false);
      });
  }, []);

  async function toggleMaintenanceMode() {
    const next = !maintenanceMode;
    setMaintenanceMode(next);
    await supabase.from("system_settings").update({ value: next }).eq("key", "platform_maintenance_mode");
  }

  async function save(key: string, value: unknown) {
    setSavingKey(key);
    setMessage(null);
    const { error } = await supabase.from("system_settings").update({ value }).eq("key", key);
    setSavingKey(null);
    setMessage(error ? error.message : `Saved "${key}".`);
  }

  if (loading) return <p className="text-gray-500">Loading settings...</p>;

  return (
    <div className="max-w-3xl space-y-4">
      <h1 className="text-xl font-bold mb-1">Platform Settings</h1>
      <p className="text-sm text-gray-500 mb-4">
        These control customer and merchant app behavior directly — no code change or redeploy required.
      </p>
      {message && <p className="text-sm bg-navy-50 text-navy rounded-md px-3 py-2">{message}</p>}

      <section className={`border rounded-lg p-4 ${maintenanceMode ? "bg-red-50 border-red-300" : "bg-white"}`}>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-medium">Platform maintenance mode</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              A master kill switch — while on, customers cannot place new orders anywhere on the platform. Tolo staff are unaffected.
            </p>
          </div>
          <button
            type="button"
            onClick={toggleMaintenanceMode}
            className={`w-12 h-7 rounded-full transition-colors relative flex-shrink-0 ml-4 ${maintenanceMode ? "bg-red-600" : "bg-gray-300"}`}
          >
            <span
              className={`absolute top-0.5 w-6 h-6 bg-white rounded-full transition-transform ${maintenanceMode ? "translate-x-5" : "translate-x-0.5"}`}
            />
          </button>
        </div>
        {maintenanceMode && (
          <p className="text-xs text-red-800 font-medium mt-2">
            ⚠ Live now — checkout is blocked for all customers until this is switched off.
          </p>
        )}
      </section>

      <section className="bg-white border rounded-lg p-4">
        <h2 className="font-medium mb-3">Commerce</h2>
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-sm font-medium">Product publication</p>
            <p className="text-xs text-gray-500">Whether merchant products need Tolo approval before going live.</p>
          </div>
          <select
            value={productPublicationMode}
            onChange={(e) => {
              setProductPublicationMode(e.target.value);
              save("product_publication_mode", e.target.value);
            }}
            className="border rounded-md px-2 py-1.5 text-sm"
          >
            <option value="approval_required">Approval required</option>
            <option value="auto_publish">Auto-publish</option>
          </select>
        </div>
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium">Minimum order value (ETB)</p>
          <div className="flex items-center gap-2">
            <input
              type="number"
              value={minOrderValue}
              onChange={(e) => setMinOrderValue(e.target.value)}
              className="w-28 border rounded-md px-2 py-1.5 text-sm"
            />
            <button
              onClick={() => save("min_order_value", Number(minOrderValue))}
              disabled={savingKey === "min_order_value"}
              className="text-xs bg-navy text-white px-3 py-1.5 rounded-md hover:bg-navy-dark disabled:opacity-60"
            >
              Save
            </button>
          </div>
        </div>
      </section>

      <section className="bg-white border rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-medium">Payment methods</h2>
          <button
            onClick={() => save("payment_methods", paymentMethods)}
            disabled={savingKey === "payment_methods"}
            className="text-xs bg-navy text-white px-3 py-1.5 rounded-md hover:bg-navy-dark disabled:opacity-60"
          >
            Save
          </button>
        </div>
        {(
          [
            ["cash_on_delivery", "Cash on delivery"],
            ["bank_transfer", "Bank transfer"],
            ["mobile_money", "Mobile money"],
          ] as const
        ).map(([k, label]) => (
          <label key={k} className="flex items-center justify-between py-1.5 text-sm">
            {label}
            <input
              type="checkbox"
              checked={paymentMethods[k]}
              onChange={(e) => setPaymentMethods({ ...paymentMethods, [k]: e.target.checked })}
            />
          </label>
        ))}
        <p className="text-xs text-gray-400 mt-2">Disabled methods disappear from the customer checkout screen automatically.</p>
      </section>

      <section className="bg-white border rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-medium">Delivery</h2>
          <button
            onClick={() => save("delivery", delivery)}
            disabled={savingKey === "delivery"}
            className="text-xs bg-navy text-white px-3 py-1.5 rounded-md hover:bg-navy-dark disabled:opacity-60"
          >
            Save
          </button>
        </div>
        <label className="flex items-center justify-between py-1.5 text-sm">
          Delivery enabled
          <input type="checkbox" checked={delivery.enabled} onChange={(e) => setDelivery({ ...delivery, enabled: e.target.checked })} />
        </label>
        <div className="grid grid-cols-3 gap-2 mt-2">
          <div>
            <label className="text-xs text-gray-500 block mb-1">Base fee (ETB)</label>
            <input
              type="number"
              value={delivery.base_fee}
              onChange={(e) => setDelivery({ ...delivery, base_fee: Number(e.target.value) })}
              className="w-full border rounded-md px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">Free above (ETB)</label>
            <input
              type="number"
              value={delivery.free_delivery_threshold ?? ""}
              onChange={(e) => setDelivery({ ...delivery, free_delivery_threshold: e.target.value ? Number(e.target.value) : null })}
              className="w-full border rounded-md px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">Max distance (km)</label>
            <input
              type="number"
              value={delivery.max_delivery_distance_km ?? ""}
              onChange={(e) => setDelivery({ ...delivery, max_delivery_distance_km: e.target.value ? Number(e.target.value) : null })}
              className="w-full border rounded-md px-2 py-1.5 text-sm"
            />
          </div>
        </div>
      </section>

      <section className="bg-white border rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-medium">Customer app features</h2>
          <button
            onClick={() => save("customer_features", customerFeatures)}
            disabled={savingKey === "customer_features"}
            className="text-xs bg-navy text-white px-3 py-1.5 rounded-md hover:bg-navy-dark disabled:opacity-60"
          >
            Save
          </button>
        </div>
        {(
          [
            ["reviews_enabled", "Product reviews"],
            ["wallet_enabled", "Customer wallet"],
            ["referrals_enabled", "Referral system"],
            ["guest_browsing_enabled", "Guest browsing (no login to browse)"],
            ["favorites_enabled", "Favorites / saved products"],
            ["scheduled_orders_enabled", "Scheduled orders"],
            ["order_cancellation_enabled", "Customer can cancel an order"],
            ["promo_codes_enabled", "Promo code entry at checkout"],
          ] as const
        ).map(([k, label]) => (
          <label key={k} className="flex items-center justify-between py-1.5 text-sm">
            {label}
            <input
              type="checkbox"
              checked={customerFeatures[k]}
              onChange={(e) => setCustomerFeatures({ ...customerFeatures, [k]: e.target.checked })}
            />
          </label>
        ))}
      </section>

      <section className="bg-white border rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-medium">Merchant app features</h2>
          <button
            onClick={() => save("merchant_features", merchantFeatures)}
            disabled={savingKey === "merchant_features"}
            className="text-xs bg-navy text-white px-3 py-1.5 rounded-md hover:bg-navy-dark disabled:opacity-60"
          >
            Save
          </button>
        </div>
        {(
          [
            ["self_registration_enabled", "Merchants can self-register"],
            ["auto_publish_products", "Auto-publish new products"],
            ["bulk_upload_enabled", "Bulk product upload"],
            ["staff_accounts_enabled", "Merchant staff accounts"],
            ["multiple_branches_enabled", "Multiple branches per merchant"],
            ["settlement_requests_enabled", "Merchant-initiated settlement requests"],
          ] as const
        ).map(([k, label]) => (
          <label key={k} className="flex items-center justify-between py-1.5 text-sm">
            {label}
            <input
              type="checkbox"
              checked={merchantFeatures[k]}
              onChange={(e) => setMerchantFeatures({ ...merchantFeatures, [k]: e.target.checked })}
            />
          </label>
        ))}
      </section>

      <section className="bg-white border rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-medium">Merchant new-order alerts</h2>
          <button
            onClick={() => save("merchant_new_order_alerts", newOrderAlerts)}
            disabled={savingKey === "merchant_new_order_alerts"}
            className="text-xs bg-navy text-white px-3 py-1.5 rounded-md hover:bg-navy-dark disabled:opacity-60"
          >
            Save
          </button>
        </div>
        <label className="flex items-center justify-between py-1.5 text-sm">
          Vibrate on new order
          <input
            type="checkbox"
            checked={newOrderAlerts.vibrate}
            onChange={(e) => setNewOrderAlerts({ ...newOrderAlerts, vibrate: e.target.checked })}
          />
        </label>
        <div className="grid grid-cols-2 gap-2 mt-2">
          <div>
            <label className="text-xs text-gray-500 block mb-1">Reminder every (minutes)</label>
            <input
              type="number"
              value={newOrderAlerts.reminder_interval_minutes}
              onChange={(e) => setNewOrderAlerts({ ...newOrderAlerts, reminder_interval_minutes: Number(e.target.value) })}
              className="w-full border rounded-md px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">Escalate to Tolo ops after (minutes)</label>
            <input
              type="number"
              value={newOrderAlerts.escalate_after_minutes}
              onChange={(e) => setNewOrderAlerts({ ...newOrderAlerts, escalate_after_minutes: Number(e.target.value) })}
              className="w-full border rounded-md px-2 py-1.5 text-sm"
            />
          </div>
        </div>
      </section>

      <section className="bg-white border rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="font-medium">Notification channels</h2>
            <p className="text-xs text-gray-500 mt-0.5">Turn a whole delivery channel off platform-wide (e.g. during an SMS provider outage).</p>
          </div>
          <button
            onClick={() => save("notification_channels", notificationChannels)}
            disabled={savingKey === "notification_channels"}
            className="text-xs bg-navy text-white px-3 py-1.5 rounded-md hover:bg-navy-dark disabled:opacity-60"
          >
            Save
          </button>
        </div>
        {(
          [
            ["push", "Push notifications"],
            ["sms", "SMS"],
            ["email", "Email"],
            ["in_app", "In-app notifications"],
          ] as const
        ).map(([k, label]) => (
          <label key={k} className="flex items-center justify-between py-1.5 text-sm">
            {label}
            <input
              type="checkbox"
              checked={notificationChannels[k]}
              onChange={(e) => setNotificationChannels({ ...notificationChannels, [k]: e.target.checked })}
            />
          </label>
        ))}
      </section>
    </div>
  );
}
