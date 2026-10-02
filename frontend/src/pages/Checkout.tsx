import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { MapPin } from "lucide-react";
import { Button, Stepper, toast, useTranslation } from "@tolo/ui";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/AuthContext";
import { useCart } from "../lib/CartContext";
import { getCurrentLocation } from "../lib/geolocation";
import { isEmbedMode, notifyOrderPlaced, openPayment } from "../lib/appBridge";
import type { Address } from "../types";

// Fixed display/default-selection order, matching the admin Settings.tsx
// toggle order exactly — NOT derived from Object.entries() on the stored
// JSON. The stored system_settings.payment_methods value's key order isn't
// guaranteed stable (it drifted to mobile_money-first at some point after
// being re-saved), which silently made "Mobile money" the pre-selected
// default radio button regardless of which methods were actually enabled or
// what a customer intended to pick.
// chapa/telebirr are online gateway methods: they only appear once an admin
// switches them on in Settings AND checkout accepts them (a gateway is
// connected), see supabase/functions/checkout/index.ts.
const PAYMENT_METHOD_ORDER = ["cash_on_delivery", "bank_transfer", "mobile_money", "chapa", "telebirr"] as const;

const ADDRESS_LABEL_KEYS: Record<string, string> = {
  Home: "savedLocations.labelHome",
  Work: "savedLocations.labelWork",
  Other: "savedLocations.labelOther",
};

export function Checkout() {
  const { user } = useAuth();
  const { items, refresh } = useCart();
  const navigate = useNavigate();
  const embed = isEmbedMode();
  const { t } = useTranslation();

  const PAYMENT_METHOD_LABELS: Record<string, string> = {
    cash_on_delivery: t("checkout.cashOnDelivery"),
    bank_transfer: t("checkout.bankTransfer"),
    mobile_money: t("checkout.mobileMoney"),
    chapa: t("checkout.chapa"),
    telebirr: t("checkout.telebirr"),
  };

  const [addresses, setAddresses] = useState<Address[]>([]);
  const [addressId, setAddressId] = useState<string | null>(null);
  const [showNewAddress, setShowNewAddress] = useState(false);
  const [form, setForm] = useState({
    recipient_name: "",
    phone: "",
    line1: "",
    city: "",
    sub_city: "",
    landmark: "",
    label: "Home",
    latitude: null as number | null,
    longitude: null as number | null,
  });
  const [locating, setLocating] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [paymentMethods, setPaymentMethods] = useState<[string, string][]>([]);
  const [paymentProvider, setPaymentProvider] = useState<string | null>(null);
  // In-app wallet handoff to the native app shell — additive to the normal
  // payment_provider methods above, not a replacement. The order is still
  // placed against a real enabled provider (checkout/index.ts only accepts
  // the keys in system_settings.payment_methods); picking this just also
  // tells the native app to collect payment via its wallet after checkout
  // succeeds, alongside the usual order-placed notification.
  const [useWallet, setUseWallet] = useState(false);
  const [acceptedTerms, setAcceptedTerms] = useState(false);

  // Dead until this task: system_settings.customer_features.promo_codes_enabled
  // already existed (admin-dashboard Settings.tsx, migration 0027) with no
  // customer-facing field anywhere to actually gate.
  const [promoCodesEnabled, setPromoCodesEnabled] = useState(false);
  const [promoCode, setPromoCode] = useState("");
  const [promoStatus, setPromoStatus] = useState<"idle" | "checking" | "valid" | "invalid" | "not_applicable">("idle");
  const [promoDiscountAmount, setPromoDiscountAmount] = useState<number | null>(null);
  const [promoRuleName, setPromoRuleName] = useState<string | null>(null);

  // Same dead-toggle situation as promo codes: system_settings.
  // customer_features.scheduled_orders_enabled existed with no picker
  // anywhere (migration 0027). Bounds mirror create_order()'s own
  // validation (system_settings.scheduled_orders, migration 0048) so the
  // picker doesn't let someone pick a time the server will just reject.
  const [scheduledOrdersEnabled, setScheduledOrdersEnabled] = useState(false);
  const [deliveryTiming, setDeliveryTiming] = useState<"now" | "scheduled">("now");
  const [scheduledFor, setScheduledFor] = useState("");
  const [scheduleBounds, setScheduleBounds] = useState({ minLeadMinutes: 60, maxAdvanceDays: 7 });

  // Mobile step flow (Address → Delivery time → Payment → Review) — purely a
  // display concern layered on top of the existing form state above; it
  // never changes what gets validated or submitted, just which of the
  // sections below is visible at once on a narrow screen.
  const [stepIndex, setStepIndex] = useState(0);

  // Group 4, item 16: a tip for the delivery rider, never merged into the
  // order total shown/charged for merchandise — it's added separately to
  // what's actually collected (see amountToPay below) but never touches
  // merchant commission or payouts (migration 0066).
  const [riderTip, setRiderTip] = useState(0);
  const [customTip, setCustomTip] = useState("");

  const subtotal = items.reduce((sum, item) => sum + item.product_variants.customer_price * item.quantity, 0);
  const total = subtotal - (promoStatus === "valid" ? (promoDiscountAmount ?? 0) : 0);
  const amountToPay = total + riderTip;

  useEffect(() => {
    supabase
      .from("system_settings")
      .select("value")
      .eq("key", "customer_features")
      .maybeSingle()
      .then(({ data }) => {
        const features = data?.value as { promo_codes_enabled?: boolean; scheduled_orders_enabled?: boolean } | null;
        setPromoCodesEnabled(features?.promo_codes_enabled ?? true);
        setScheduledOrdersEnabled(features?.scheduled_orders_enabled ?? false);
      });
    supabase
      .from("system_settings")
      .select("value")
      .eq("key", "scheduled_orders")
      .maybeSingle()
      .then(({ data }) => {
        const bounds = data?.value as { min_lead_minutes?: number; max_advance_days?: number } | null;
        setScheduleBounds({ minLeadMinutes: bounds?.min_lead_minutes ?? 60, maxAdvanceDays: bounds?.max_advance_days ?? 7 });
      });
  }, []);

  useEffect(() => {
    // Admin can turn payment methods on/off from Settings — disabled methods
    // never reach the checkout screen (spec: "backend decides, frontend follows").
    supabase
      .from("system_settings")
      .select("value")
      .eq("key", "payment_methods")
      .maybeSingle()
      .then(({ data }) => {
        const methods = (data?.value as Record<string, boolean>) ?? {};
        const enabled = PAYMENT_METHOD_ORDER.filter((key) => methods[key]).map(
          (key) => [key, PAYMENT_METHOD_LABELS[key] ?? key] as [string, string],
        );
        setPaymentMethods(enabled);
        setPaymentProvider(enabled[0]?.[0] ?? null);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!user) return;
    supabase
      .from("addresses")
      .select("*")
      .eq("customer_id", user.id)
      .order("is_default", { ascending: false })
      .then(({ data }) => {
        setAddresses(data ?? []);
        if (data && data.length > 0) setAddressId(data[0].id);
        else setShowNewAddress(true);
      });
    // Customer's phone/name come from their account — never re-typed (spec: no duplicate data entry).
    supabase
      .from("profiles")
      .select("full_name, phone")
      .eq("id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (data) setForm((f) => ({ ...f, recipient_name: f.recipient_name || data.full_name || "", phone: f.phone || data.phone || "" }));
      });
  }, [user]);

  async function handleUseCurrentLocation() {
    setLocating(true);
    try {
      const loc = await getCurrentLocation();
      setForm((f) => ({
        ...f,
        latitude: loc.latitude,
        longitude: loc.longitude,
        line1: loc.line1 || f.line1,
        city: loc.city || f.city,
        sub_city: loc.subCity || f.sub_city,
      }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("checkout.couldNotGetLocation"));
    } finally {
      setLocating(false);
    }
  }

  async function handleSaveAddress() {
    if (!user) return;
    const { data, error } = await supabase
      .from("addresses")
      .insert({ customer_id: user.id, ...form, country: "ET", is_default: addresses.length === 0 })
      .select()
      .single();
    if (error) {
      toast.error(error.message);
      return;
    }
    setAddresses((prev) => [...prev, data]);
    setAddressId(data.id);
    setShowNewAddress(false);
  }

  // datetime-local needs "YYYY-MM-DDTHH:mm" in the browser's local time —
  // same conversion PricingRules.tsx's admin form already uses for its
  // starts_at/ends_at fields.
  function toDatetimeLocal(d: Date): string {
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  const scheduleMin = toDatetimeLocal(new Date(Date.now() + scheduleBounds.minLeadMinutes * 60_000));
  const scheduleMax = toDatetimeLocal(new Date(Date.now() + scheduleBounds.maxAdvanceDays * 86_400_000));

  function cartScopeIds() {
    const merchantIds = new Set<string>();
    const categoryIds = new Set<string>();
    const productIds = new Set<string>();
    for (const item of items) {
      const product = item.product_variants.products;
      merchantIds.add(product.merchant_id);
      productIds.add(product.id);
      if (product.category_id) categoryIds.add(product.category_id);
    }
    return { merchantIds: [...merchantIds], categoryIds: [...categoryIds], productIds: [...productIds] };
  }

  async function handleApplyPromoCode() {
    const code = promoCode.trim();
    if (!code) return;
    setPromoStatus("checking");
    const { merchantIds, categoryIds, productIds } = cartScopeIds();
    const { data, error } = await supabase
      .rpc("validate_discount_code", {
        p_code: code,
        p_merchant_ids: merchantIds,
        p_category_ids: categoryIds,
        p_product_ids: productIds,
        p_order_subtotal: subtotal,
      })
      .single();

    if (error || !data) {
      setPromoStatus("invalid");
      setPromoDiscountAmount(null);
      setPromoRuleName(null);
      return;
    }
    const result = data as { status: "valid" | "invalid" | "not_applicable"; discount_amount: number | null; rule_name: string | null };
    setPromoStatus(result.status);
    setPromoDiscountAmount(result.discount_amount);
    setPromoRuleName(result.rule_name);
  }

  async function handlePlaceOrder() {
    if (!addressId) {
      toast.error(t("checkout.selectAddressError"));
      return;
    }
    if (!paymentProvider) {
      toast.error(t("checkout.noPaymentMethod"));
      return;
    }
    if (scheduledOrdersEnabled && deliveryTiming === "scheduled" && !scheduledFor) {
      toast.error(t("checkout.selectDeliveryTimeError"));
      return;
    }
    if (!acceptedTerms) {
      toast.error(t("checkout.acceptTermsError"));
      return;
    }
    setPlacing(true);

    const { data: checkoutData, error: checkoutError } = await supabase.functions.invoke("checkout", {
      body: {
        address_id: addressId,
        payment_provider: paymentProvider,
        promo_code: promoCode.trim() || undefined,
        scheduled_for:
          scheduledOrdersEnabled && deliveryTiming === "scheduled" && scheduledFor ? new Date(scheduledFor).toISOString() : undefined,
        rider_tip: riderTip > 0 ? riderTip : undefined,
      },
    });

    if (checkoutError || !checkoutData) {
      // supabase-js doesn't auto-parse a non-2xx function response body into
      // error.message — it has to be read from the raw response ourselves,
      // or the specific message the function returned (e.g. "out of stock",
      // "account suspended") never reaches the user, just a generic failure.
      let message = t("checkout.genericError");
      const context = (checkoutError as { context?: Response })?.context;
      if (context) {
        try {
          const body = await context.clone().json();
          // The rate-limit response carries both a machine-readable "error"
          // code and a human-readable "message" (checkout/index.ts) — every
          // other error path only sets "error" as the display string.
          if (body?.message) message = body.message;
          else if (body?.error) message = body.error;
        } catch {
          // Non-JSON error body — fall back to the generic message above.
        }
      }
      toast.error(message);
      setPlacing(false);
      return;
    }

    // Cash, bank transfer and mobile money are confirmed manually by a
    // merchant or Tolo finance once the money has actually moved (see
    // confirm-payment), never assumed here. Online gateway methods (Chapa,
    // Telebirr) instead return checkout_url: the gateway's hosted page, where
    // the customer pays; the gateway then tells our backend (payment-webhook)
    // and the order page shows the result.
    await refresh();
    if (typeof checkoutData.checkout_url === "string" && /^https?:\/\//.test(checkoutData.checkout_url)) {
      // Deliberately leaves `placing` on so the button stays disabled while
      // the browser leaves for the payment page.
      window.location.assign(checkoutData.checkout_url);
      return;
    }
    setPlacing(false);
    // The order exists but the payment page couldn't be opened (gateway
    // hiccup): the order page has a "Pay now" button to try again.
    if (checkoutData.payment_error) toast.error(t("checkout.paymentStartFailed"));
    if (embed) {
      notifyOrderPlaced(checkoutData.order_id);
      if (useWallet) openPayment(checkoutData.order_id, total);
    }
    navigate(`/orders/${checkoutData.order_id}/confirmation`);
  }

  if (items.length === 0) {
    return <p className="text-gray-500 dark:text-gray-400">{t("errors.cartEmpty")}</p>;
  }

  // Step list for the mobile flow — "Delivery time" is only a step when
  // there's actually something to configure there; when scheduled orders
  // are off, the order is always delivered ASAP and that step is skipped
  // entirely rather than shown with nothing in it.
  const steps = [
    { key: "address", label: t("checkout.stepAddress") },
    ...(scheduledOrdersEnabled ? [{ key: "delivery", label: t("checkout.stepDelivery") }] : []),
    { key: "payment", label: t("checkout.stepPayment") },
    { key: "review", label: t("checkout.stepReview") },
  ];
  const clampedStep = Math.min(stepIndex, steps.length - 1);
  const currentStepKey = steps[clampedStep].key;

  function goBack() {
    setStepIndex((i) => Math.max(i - 1, 0));
  }
  function goNext() {
    setStepIndex((i) => Math.min(i + 1, steps.length - 1));
  }

  const addressSection = (
    <div className="bg-white dark:bg-navy-dark border rounded-lg p-4 mb-4">
      <h2 className="font-medium mb-2">{t("checkout.deliverTo")}</h2>
      {addresses.map((a) => (
          <label key={a.id} className="flex items-start gap-2 mb-2 text-sm">
            <input type="radio" checked={addressId === a.id} onChange={() => setAddressId(a.id)} />
            <span>
              <strong>{a.label ? (ADDRESS_LABEL_KEYS[a.label] ? t(ADDRESS_LABEL_KEYS[a.label]) : a.label) : t("checkout.addressFallback")}</strong> — {a.recipient_name}, {a.phone}
              <br />
              <span className="inline-flex items-center gap-1">
                <MapPin className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500" />
                {a.line1}, {a.city}
              </span>
              {a.latitude && <span className="text-xs text-gray-400 dark:text-gray-500"> {t("checkout.gpsConfirmed")}</span>}
            </span>
          </label>
        ))}

        {!showNewAddress && (
          <button onClick={() => setShowNewAddress(true)} className="text-navy text-sm font-medium mt-1">
            {t("checkout.addNewAddress")}
          </button>
        )}

        {showNewAddress && (
          <div className="mt-2 space-y-2">
            <button
              onClick={handleUseCurrentLocation}
              disabled={locating}
              type="button"
              className="w-full border-2 border-navy text-navy rounded-md px-3 py-2 text-sm font-medium hover:bg-navy-50 disabled:opacity-60"
            >
              {locating ? (
                t("checkout.gettingLocation")
              ) : (
                <span className="inline-flex items-center justify-center gap-1.5 w-full">
                  <MapPin className="w-4 h-4" />
                  {t("checkout.useCurrentLocation")}
                </span>
              )}
            </button>

            {form.latitude && (
              <p className="text-xs text-navy bg-navy-50 rounded-md px-3 py-2 flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5 flex-shrink-0" />
                {t("checkout.locationConfirmedNote")}
              </p>
            )}

            <input
              placeholder={t("checkout.recipientName")}
              value={form.recipient_name}
              onChange={(e) => setForm({ ...form, recipient_name: e.target.value })}
              className="w-full border rounded-md px-3 py-2 text-sm"
            />
            <input
              placeholder={t("auth.phone")}
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              className="w-full border rounded-md px-3 py-2 text-sm"
            />
            <input
              placeholder={t("checkout.streetArea")}
              value={form.line1}
              onChange={(e) => setForm({ ...form, line1: e.target.value })}
              className="w-full border rounded-md px-3 py-2 text-sm"
            />
            <div className="grid grid-cols-2 gap-2">
              <input
                placeholder={t("checkout.city")}
                value={form.city}
                onChange={(e) => setForm({ ...form, city: e.target.value })}
                className="w-full border rounded-md px-3 py-2 text-sm"
              />
              <input
                placeholder={t("checkout.subCityOptional")}
                value={form.sub_city}
                onChange={(e) => setForm({ ...form, sub_city: e.target.value })}
                className="w-full border rounded-md px-3 py-2 text-sm"
              />
            </div>
            <input
              placeholder={t("checkout.landmarkOptional")}
              value={form.landmark}
              onChange={(e) => setForm({ ...form, landmark: e.target.value })}
              className="w-full border rounded-md px-3 py-2 text-sm"
            />
            <button onClick={handleSaveAddress} className="text-sm bg-gray-800 text-white px-3 py-1.5 rounded-md">
              {t("checkout.saveAddress")}
            </button>
          </div>
        )}
      </div>
  );

  const paymentSection = (
    <div className="bg-white dark:bg-navy-dark border rounded-lg p-4 mb-4">
      <h2 className="font-medium mb-2">{t("checkout.paymentMethod")}</h2>
      {paymentMethods.length === 0 ? (
        <p className="text-sm text-red-600">{t("checkout.noPaymentMethod")}</p>
      ) : (
        paymentMethods.map(([key, label]) => (
          <label key={key} className="flex items-center gap-2 mb-1 text-sm">
            <input type="radio" checked={paymentProvider === key} onChange={() => setPaymentProvider(key)} />
            {label}
          </label>
        ))
      )}
      {embed && (
        <label className="flex items-center gap-2 mt-2 pt-2 border-t text-sm">
          <input type="checkbox" checked={useWallet} onChange={(e) => setUseWallet(e.target.checked)} />
          {t("checkout.payWithWallet")}
        </label>
      )}
    </div>
  );

  const deliverySection = scheduledOrdersEnabled && (
    <div className="bg-white dark:bg-navy-dark border rounded-lg p-4 mb-4">
      <h2 className="font-medium mb-2">{t("checkout.deliveryTime")}</h2>
      <div className="flex gap-2 mb-2">
        <button
          type="button"
              onClick={() => setDeliveryTiming("now")}
              className={`flex-1 px-3 py-2 rounded-md text-sm font-medium border ${
                deliveryTiming === "now" ? "bg-navy text-white border-navy" : "bg-white dark:bg-navy-dark text-gray-600 dark:text-gray-300"
              }`}
            >
              {t("checkout.deliverNow")}
            </button>
            <button
              type="button"
              onClick={() => setDeliveryTiming("scheduled")}
              className={`flex-1 px-3 py-2 rounded-md text-sm font-medium border ${
                deliveryTiming === "scheduled" ? "bg-navy text-white border-navy" : "bg-white dark:bg-navy-dark text-gray-600 dark:text-gray-300"
              }`}
            >
              {t("checkout.scheduleForLater")}
            </button>
          </div>
          {deliveryTiming === "scheduled" && (
            <>
              <input
                type="datetime-local"
                value={scheduledFor}
                min={scheduleMin}
                max={scheduleMax}
                onChange={(e) => setScheduledFor(e.target.value)}
                className="w-full border rounded-md px-3 py-2 text-sm"
              />
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                {t("checkout.deliveryTimeNote", {
                  lead:
                    scheduleBounds.minLeadMinutes >= 60
                      ? `${scheduleBounds.minLeadMinutes / 60} ${t("checkout.hoursUnit")}`
                      : `${scheduleBounds.minLeadMinutes} ${t("checkout.minutesUnit")}`,
                  days: scheduleBounds.maxAdvanceDays,
                })}
              </p>
            </>
          )}
        </div>
  );

  const promoSection = promoCodesEnabled && (
        <div className="bg-white dark:bg-navy-dark border rounded-lg p-4 mb-4">
          <h2 className="font-medium mb-2">{t("checkout.promoCode")}</h2>
          <div className="flex gap-2">
            <input
              placeholder={t("checkout.enterCode")}
              value={promoCode}
              onChange={(e) => {
                setPromoCode(e.target.value);
                setPromoStatus("idle");
              }}
              className="flex-1 border rounded-md px-3 py-2 text-sm uppercase placeholder:normal-case"
            />
            <button
              type="button"
              onClick={handleApplyPromoCode}
              disabled={!promoCode.trim() || promoStatus === "checking"}
              className="border-2 border-navy text-navy px-4 py-2 rounded-md text-sm font-medium hover:bg-navy-50 disabled:opacity-60"
            >
              {promoStatus === "checking" ? t("checkout.checking") : t("checkout.apply")}
            </button>
          </div>
          {promoStatus === "valid" && (
            <p className="text-emerald-700 text-sm mt-2">
              {t("checkout.promoAppliedNote", { ruleName: promoRuleName ?? "", amount: (promoDiscountAmount ?? 0).toFixed(2) })}
            </p>
          )}
          {promoStatus === "invalid" && <p className="text-red-600 text-sm mt-2">{t("checkout.promoInvalid")}</p>}
          {promoStatus === "not_applicable" && <p className="text-orange-600 text-sm mt-2">{t("checkout.promoNotApplicable")}</p>}
        </div>
  );

  const summarySection = (
    <>
      <div className="bg-white dark:bg-navy-dark border rounded-lg p-4 mb-4">
        <h2 className="font-medium mb-2">{t("checkout.riderTip")}</h2>
        <div className="flex gap-2 mb-2">
          {[0, 10, 20, 50].map((amount) => (
            <button
              key={amount}
              type="button"
              onClick={() => {
                setRiderTip(amount);
                setCustomTip("");
              }}
              className={`flex-1 px-2 py-2 rounded-md text-sm font-medium border ${
                riderTip === amount && customTip === "" ? "bg-navy text-white border-navy" : "bg-white dark:bg-navy-dark text-gray-600 dark:text-gray-300"
              }`}
            >
              {amount === 0 ? t("checkout.noTip") : `${amount} ETB`}
            </button>
          ))}
        </div>
        <input
          type="number"
          min={0}
          placeholder={t("checkout.customAmount")}
          value={customTip}
          onChange={(e) => {
            setCustomTip(e.target.value);
            const parsed = Number(e.target.value);
            setRiderTip(Number.isFinite(parsed) && parsed >= 0 ? parsed : 0);
          }}
          className="w-full border rounded-md px-3 py-2 text-sm"
        />
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{t("checkout.riderTipNote")}</p>
      </div>

      <div className="bg-white dark:bg-navy-dark border rounded-lg p-4 mb-4 text-sm space-y-1">
        <div className="flex justify-between">
          <span>{t("checkout.subtotal")}</span>
          <span>{subtotal.toFixed(2)} ETB</span>
        </div>
        {promoStatus === "valid" && (
          <div className="flex justify-between text-emerald-700">
            <span>{t("checkout.promoDiscount")}</span>
            <span>-{(promoDiscountAmount ?? 0).toFixed(2)} ETB</span>
          </div>
        )}
        <div className="flex justify-between font-semibold border-t pt-1 mt-1">
          <span>{t("checkout.total")}</span>
          <span>{total.toFixed(2)} ETB</span>
        </div>
        {riderTip > 0 && (
          <div className="flex justify-between">
            <span>{t("orders.riderTip")}</span>
            <span>{riderTip.toFixed(2)} ETB</span>
          </div>
        )}
        <div className="flex justify-between font-semibold border-t pt-1 mt-1">
          <span>{t("checkout.youllPay")}</span>
          <span>{amountToPay.toFixed(2)} ETB</span>
        </div>
      </div>
      <p className="text-xs text-gray-400 dark:text-gray-500 -mt-3 mb-4">{t("checkout.deliveryFeeNote")}</p>
    </>
  );

  const termsCheckbox = (
    <label className="flex items-start gap-2 text-xs text-gray-600 dark:text-gray-300 mb-3">
      <input
        type="checkbox"
        checked={acceptedTerms}
        onChange={(e) => setAcceptedTerms(e.target.checked)}
        className="mt-0.5"
      />
      <span>
        {t("checkout.agreeToTermsPrefix")}{" "}
        <Link to="/legal/terms" target="_blank" rel="noopener noreferrer" className="text-navy underline">
          {t("footer.terms")}
        </Link>
        ,{" "}
        <Link to="/legal/privacy" target="_blank" rel="noopener noreferrer" className="text-navy underline">
          {t("footer.privacy")}
        </Link>
        , {t("checkout.and")}{" "}
        <Link to="/legal/refund-policy" target="_blank" rel="noopener noreferrer" className="text-navy underline">
          {t("footer.refundPolicy")}
        </Link>
        .
      </span>
    </label>
  );

  const placeOrderButton = (
    <button
      onClick={handlePlaceOrder}
      disabled={placing || !acceptedTerms}
      className="w-full bg-navy text-white py-2.5 rounded-md font-medium hover:bg-navy-dark disabled:opacity-60"
    >
      {placing ? t("checkout.placingOrder") : t("checkout.placeOrder")}
    </button>
  );

  const stepSections: Record<string, ReactNode> = {
    address: addressSection,
    delivery: deliverySection,
    payment: paymentSection,
    review: (
      <>
        {promoSection}
        {summarySection}
        {termsCheckbox}
      </>
    ),
  };

  return (
    <div className="max-w-lg">
      <h1 className="text-xl font-bold mb-4">{t("checkout.title")}</h1>
      <Stepper steps={steps} currentIndex={clampedStep} className="mb-6" />

      {/* Phones: one step's fields at a time, with Back/Next. */}
      <div className="md:hidden">
        {stepSections[currentStepKey]}
        <div className="flex gap-2 mt-2">
          {clampedStep > 0 && (
            <Button type="button" variant="outline" className="flex-1" onClick={goBack}>
              {t("common.back")}
            </Button>
          )}
          {clampedStep < steps.length - 1 ? (
            <Button type="button" className="flex-1" onClick={goNext}>
              {t("common.next")}
            </Button>
          ) : (
            <div className="flex-1">{placeOrderButton}</div>
          )}
        </div>
      </div>

      {/* Desktop and up: the whole form on one page, same as before. */}
      <div className="hidden md:block">
        {addressSection}
        {paymentSection}
        {deliverySection}
        {promoSection}
        {summarySection}
        {termsCheckbox}
        {placeOrderButton}
      </div>
    </div>
  );
}
