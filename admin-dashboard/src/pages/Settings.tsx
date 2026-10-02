import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { supabase } from "../lib/supabase";
import { SkeletonPage, toast, useTranslation } from "@tolo/ui";
import { SmsOutboxPanel } from "../components/SmsOutboxPanel";

interface PaymentMethods {
  cash_on_delivery: boolean;
  bank_transfer: boolean;
  mobile_money: boolean;
  chapa: boolean;
  telebirr: boolean;
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

interface AutoCancelSettings {
  enabled: boolean;
  after_minutes: number;
}

interface CodFraudControls {
  enabled: boolean;
  new_account_age_days: number;
  max_cod_orders: number;
  max_cod_amount_etb: number;
}

interface NotificationChannels {
  push: boolean; // UI-only — no push provider is connected, _shared/notify.ts never checks this
  sms: boolean;
  email: boolean;
  in_app: boolean;
}

const DEFAULTS = {
  payment_methods: { cash_on_delivery: true, bank_transfer: true, mobile_money: true, chapa: false, telebirr: false } satisfies PaymentMethods,
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
  auto_cancel_unresponsive_orders: { enabled: true, after_minutes: 30 } satisfies AutoCancelSettings,
  cod_fraud_controls: {
    enabled: true,
    new_account_age_days: 7,
    max_cod_orders: 3,
    max_cod_amount_etb: 2000,
  } satisfies CodFraudControls,
  notification_channels: { push: true, sms: true, email: true, in_app: true } satisfies NotificationChannels,
};

export function Settings() {
  const { t } = useTranslation();
  const [maintenanceMode, setMaintenanceMode] = useState(false);
  const [minOrderValue, setMinOrderValue] = useState("0");
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethods>(DEFAULTS.payment_methods);
  const [delivery, setDelivery] = useState<DeliverySettings>(DEFAULTS.delivery);
  const [customerFeatures, setCustomerFeatures] = useState<CustomerFeatures>(DEFAULTS.customer_features);
  const [merchantFeatures, setMerchantFeatures] = useState<MerchantFeatures>(DEFAULTS.merchant_features);
  const [newOrderAlerts, setNewOrderAlerts] = useState<NewOrderAlertSettings>(DEFAULTS.merchant_new_order_alerts);
  const [autoCancel, setAutoCancel] = useState<AutoCancelSettings>(DEFAULTS.auto_cancel_unresponsive_orders);
  const [codFraudControls, setCodFraudControls] = useState<CodFraudControls>(DEFAULTS.cod_fraud_controls);
  const [notificationChannels, setNotificationChannels] = useState<NotificationChannels>(DEFAULTS.notification_channels);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  useEffect(() => {
    supabase
      .from("system_settings")
      .select("key, value")
      .in("key", [
        "platform_maintenance_mode",
        "min_order_value",
        "payment_methods",
        "delivery",
        "customer_features",
        "merchant_features",
        "merchant_new_order_alerts",
        "auto_cancel_unresponsive_orders",
        "cod_fraud_controls",
        "notification_channels",
      ])
      .then(({ data }) => {
        for (const row of data ?? []) {
          switch (row.key) {
            case "platform_maintenance_mode":
              setMaintenanceMode(Boolean(row.value));
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
            case "auto_cancel_unresponsive_orders":
              setAutoCancel({ ...DEFAULTS.auto_cancel_unresponsive_orders, ...(row.value as object) });
              break;
            case "cod_fraud_controls":
              setCodFraudControls({ ...DEFAULTS.cod_fraud_controls, ...(row.value as object) });
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
    const { error } = await supabase.from("system_settings").update({ value }).eq("key", key);
    setSavingKey(null);
    if (error) {
      toast.error(t("settings.saveError"));
      return;
    }
    toast.success(t("settings.savedToast", { key }));
  }

  if (loading) return <SkeletonPage />;

  return (
    <div className="max-w-3xl space-y-4">
      <h1 className="text-xl font-bold mb-1">{t("settings.title")}</h1>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">{t("settings.description")}</p>

      <section className={`border rounded-lg p-4 ${maintenanceMode ? "bg-red-50 border-red-300" : "bg-white dark:bg-navy-dark"}`}>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-medium">{t("settings.maintenanceMode")}</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{t("settings.maintenanceModeDescription")}</p>
          </div>
          <button
            type="button"
            onClick={toggleMaintenanceMode}
            className={`w-12 h-7 rounded-full transition-colors relative flex-shrink-0 ml-4 ${maintenanceMode ? "bg-red-600" : "bg-gray-300"}`}
          >
            <span
              className={`absolute top-0.5 w-6 h-6 bg-white dark:bg-navy-dark rounded-full transition-transform ${maintenanceMode ? "translate-x-5" : "translate-x-0.5"}`}
            />
          </button>
        </div>
        {maintenanceMode && (
          <p className="flex items-center gap-1.5 text-xs text-red-800 font-medium mt-2">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            {t("settings.maintenanceModeLiveWarning")}
          </p>
        )}
      </section>

      <section className="bg-white dark:bg-navy-dark border rounded-lg p-4">
        <h2 className="font-medium mb-3">{t("settings.commerce")}</h2>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">{t("settings.minOrderValue")}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">{t("settings.minOrderValueDescription")}</p>
          </div>
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
              {t("common.save")}
            </button>
          </div>
        </div>
      </section>

      <section className="bg-white dark:bg-navy-dark border rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-medium">{t("settings.paymentMethods")}</h2>
          <button
            onClick={() => save("payment_methods", paymentMethods)}
            disabled={savingKey === "payment_methods"}
            className="text-xs bg-navy text-white px-3 py-1.5 rounded-md hover:bg-navy-dark disabled:opacity-60"
          >
            {t("common.save")}
          </button>
        </div>
        {(
          [
            ["cash_on_delivery", "settings.cashOnDelivery"],
            ["bank_transfer", "settings.bankTransfer"],
            ["mobile_money", "settings.mobileMoney"],
            ["chapa", "settings.chapaOnline"],
            ["telebirr", "settings.telebirrOnline"],
          ] as const
        ).map(([k, labelKey]) => (
          <label key={k} className="flex items-center justify-between py-1.5 text-sm">
            {t(labelKey)}
            <input
              type="checkbox"
              checked={paymentMethods[k]}
              onChange={(e) => setPaymentMethods({ ...paymentMethods, [k]: e.target.checked })}
            />
          </label>
        ))}
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">{t("settings.paymentMethodsNote1")}</p>
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{t("settings.paymentMethodsNote2")}</p>
      </section>

      <section className="bg-white dark:bg-navy-dark border rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-medium">{t("settings.delivery")}</h2>
          <button
            onClick={() => save("delivery", delivery)}
            disabled={savingKey === "delivery"}
            className="text-xs bg-navy text-white px-3 py-1.5 rounded-md hover:bg-navy-dark disabled:opacity-60"
          >
            {t("common.save")}
          </button>
        </div>
        <label className="flex items-center justify-between py-1.5 text-sm">
          {t("settings.deliveryEnabled")}
          <input type="checkbox" checked={delivery.enabled} onChange={(e) => setDelivery({ ...delivery, enabled: e.target.checked })} />
        </label>
        <div className="grid grid-cols-3 gap-2 mt-2">
          <div>
            <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">{t("settings.baseFee")}</label>
            <input
              type="number"
              value={delivery.base_fee}
              onChange={(e) => setDelivery({ ...delivery, base_fee: Number(e.target.value) })}
              className="w-full border rounded-md px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">{t("settings.freeAbove")}</label>
            <input
              type="number"
              value={delivery.free_delivery_threshold ?? ""}
              onChange={(e) => setDelivery({ ...delivery, free_delivery_threshold: e.target.value ? Number(e.target.value) : null })}
              className="w-full border rounded-md px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">{t("settings.maxDistance")}</label>
            <input
              type="number"
              value={delivery.max_delivery_distance_km ?? ""}
              onChange={(e) => setDelivery({ ...delivery, max_delivery_distance_km: e.target.value ? Number(e.target.value) : null })}
              className="w-full border rounded-md px-2 py-1.5 text-sm"
            />
          </div>
        </div>
      </section>

      <section className="bg-white dark:bg-navy-dark border rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-medium">{t("settings.customerAppFeatures")}</h2>
          <button
            onClick={() => save("customer_features", customerFeatures)}
            disabled={savingKey === "customer_features"}
            className="text-xs bg-navy text-white px-3 py-1.5 rounded-md hover:bg-navy-dark disabled:opacity-60"
          >
            {t("common.save")}
          </button>
        </div>
        {(
          [
            ["reviews_enabled", "settings.productReviews"],
            ["wallet_enabled", "settings.customerWallet"],
            ["referrals_enabled", "settings.referralSystem"],
            ["guest_browsing_enabled", "settings.guestBrowsing"],
            ["favorites_enabled", "settings.favoritesSaved"],
            ["scheduled_orders_enabled", "settings.scheduledOrders"],
            ["order_cancellation_enabled", "settings.customerCanCancel"],
            ["promo_codes_enabled", "settings.promoCodeEntry"],
          ] as const
        ).map(([k, labelKey]) => (
          <label key={k} className="flex items-center justify-between py-1.5 text-sm">
            {t(labelKey)}
            <input
              type="checkbox"
              checked={customerFeatures[k]}
              onChange={(e) => setCustomerFeatures({ ...customerFeatures, [k]: e.target.checked })}
            />
          </label>
        ))}
      </section>

      <section className="bg-white dark:bg-navy-dark border rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-medium">{t("settings.merchantAppFeatures")}</h2>
          <button
            onClick={() => save("merchant_features", merchantFeatures)}
            disabled={savingKey === "merchant_features"}
            className="text-xs bg-navy text-white px-3 py-1.5 rounded-md hover:bg-navy-dark disabled:opacity-60"
          >
            {t("common.save")}
          </button>
        </div>
        {(
          [
            ["self_registration_enabled", "settings.merchantSelfRegister"],
            ["bulk_upload_enabled", "settings.bulkProductUpload"],
            ["staff_accounts_enabled", "settings.merchantStaffAccounts"],
            ["multiple_branches_enabled", "settings.multipleBranches"],
            ["settlement_requests_enabled", "settings.merchantSettlementRequests"],
          ] as const
        ).map(([k, labelKey]) => (
          <label key={k} className="flex items-center justify-between py-1.5 text-sm">
            {t(labelKey)}
            <input
              type="checkbox"
              checked={merchantFeatures[k]}
              onChange={(e) => setMerchantFeatures({ ...merchantFeatures, [k]: e.target.checked })}
            />
          </label>
        ))}
      </section>

      <section className="bg-white dark:bg-navy-dark border rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-medium">{t("settings.newOrderAlerts")}</h2>
          <button
            onClick={() => save("merchant_new_order_alerts", newOrderAlerts)}
            disabled={savingKey === "merchant_new_order_alerts"}
            className="text-xs bg-navy text-white px-3 py-1.5 rounded-md hover:bg-navy-dark disabled:opacity-60"
          >
            {t("common.save")}
          </button>
        </div>
        <label className="flex items-center justify-between py-1.5 text-sm">
          {t("settings.vibrateOnNewOrder")}
          <input
            type="checkbox"
            checked={newOrderAlerts.vibrate}
            onChange={(e) => setNewOrderAlerts({ ...newOrderAlerts, vibrate: e.target.checked })}
          />
        </label>
        <div className="grid grid-cols-2 gap-2 mt-2">
          <div>
            <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">{t("settings.reminderEvery")}</label>
            <input
              type="number"
              value={newOrderAlerts.reminder_interval_minutes}
              onChange={(e) => setNewOrderAlerts({ ...newOrderAlerts, reminder_interval_minutes: Number(e.target.value) })}
              className="w-full border rounded-md px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">{t("settings.escalateAfter")}</label>
            <input
              type="number"
              value={newOrderAlerts.escalate_after_minutes}
              onChange={(e) => setNewOrderAlerts({ ...newOrderAlerts, escalate_after_minutes: Number(e.target.value) })}
              className="w-full border rounded-md px-2 py-1.5 text-sm"
            />
          </div>
        </div>
      </section>

      <section className="bg-white dark:bg-navy-dark border rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-medium">{t("settings.autoCancelUnresponsive")}</h2>
          <button
            onClick={() => save("auto_cancel_unresponsive_orders", autoCancel)}
            disabled={savingKey === "auto_cancel_unresponsive_orders"}
            className="text-xs bg-navy text-white px-3 py-1.5 rounded-md hover:bg-navy-dark disabled:opacity-60"
          >
            {t("common.save")}
          </button>
        </div>
        <p className="text-xs text-gray-400 dark:text-gray-500 mb-2">{t("settings.autoCancelDescription")}</p>
        <label className="flex items-center justify-between py-1.5 text-sm">
          {t("settings.enabled")}
          <input type="checkbox" checked={autoCancel.enabled} onChange={(e) => setAutoCancel({ ...autoCancel, enabled: e.target.checked })} />
        </label>
        <div>
          <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">{t("settings.autoCancelAfter")}</label>
          <input
            type="number"
            value={autoCancel.after_minutes}
            onChange={(e) => setAutoCancel({ ...autoCancel, after_minutes: Number(e.target.value) })}
            className="w-full border rounded-md px-2 py-1.5 text-sm"
          />
        </div>
      </section>

      <section className="bg-white dark:bg-navy-dark border rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-medium">{t("settings.codFraudControls")}</h2>
          <button
            onClick={() => save("cod_fraud_controls", codFraudControls)}
            disabled={savingKey === "cod_fraud_controls"}
            className="text-xs bg-navy text-white px-3 py-1.5 rounded-md hover:bg-navy-dark disabled:opacity-60"
          >
            {t("common.save")}
          </button>
        </div>
        <p className="text-xs text-gray-400 dark:text-gray-500 mb-2">{t("settings.codFraudControlsDescription")}</p>
        <label className="flex items-center justify-between py-1.5 text-sm">
          {t("settings.enabled")}
          <input
            type="checkbox"
            checked={codFraudControls.enabled}
            onChange={(e) => setCodFraudControls({ ...codFraudControls, enabled: e.target.checked })}
          />
        </label>
        <div className="grid grid-cols-3 gap-2 mt-2">
          <div>
            <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">{t("settings.newAccountAge")}</label>
            <input
              type="number"
              value={codFraudControls.new_account_age_days}
              onChange={(e) => setCodFraudControls({ ...codFraudControls, new_account_age_days: Number(e.target.value) })}
              className="w-full border rounded-md px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">{t("settings.maxCodOrders")}</label>
            <input
              type="number"
              value={codFraudControls.max_cod_orders}
              onChange={(e) => setCodFraudControls({ ...codFraudControls, max_cod_orders: Number(e.target.value) })}
              className="w-full border rounded-md px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">{t("settings.maxCodTotal")}</label>
            <input
              type="number"
              value={codFraudControls.max_cod_amount_etb}
              onChange={(e) => setCodFraudControls({ ...codFraudControls, max_cod_amount_etb: Number(e.target.value) })}
              className="w-full border rounded-md px-2 py-1.5 text-sm"
            />
          </div>
        </div>
      </section>

      <section className="bg-white dark:bg-navy-dark border rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="font-medium">{t("settings.notificationChannels")}</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{t("settings.notificationChannelsDescription")}</p>
          </div>
          <button
            onClick={() => save("notification_channels", notificationChannels)}
            disabled={savingKey === "notification_channels"}
            className="text-xs bg-navy text-white px-3 py-1.5 rounded-md hover:bg-navy-dark disabled:opacity-60"
          >
            {t("common.save")}
          </button>
        </div>
        {(
          [
            ["push", "settings.pushNotifications", false],
            ["sms", "settings.sms", true],
            ["email", "settings.email", true],
            ["in_app", "settings.inAppNotifications", true],
          ] as const
        ).map(([k, labelKey, available]) => (
          <label key={k} className={`flex items-center justify-between py-1.5 text-sm ${available ? "" : "opacity-50"}`}>
            <span>
              {t(labelKey)}
              {!available && <span className="text-xs text-gray-400 dark:text-gray-500 ml-1.5">{t("settings.notYetAvailable")}</span>}
            </span>
            <input
              type="checkbox"
              checked={notificationChannels[k]}
              disabled={!available}
              title={available ? undefined : t("settings.noProviderConnectedTitle")}
              onChange={(e) => setNotificationChannels({ ...notificationChannels, [k]: e.target.checked })}
            />
          </label>
        ))}
      </section>

      <SmsOutboxPanel />
    </div>
  );
}
