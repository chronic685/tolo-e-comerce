import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/AuthContext";
import { useCart } from "../lib/CartContext";
import { getCurrentLocation } from "../lib/geolocation";
import type { Address } from "../types";

export function Checkout() {
  const { user } = useAuth();
  const { items, refresh } = useCart();
  const navigate = useNavigate();

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
  const [locationError, setLocationError] = useState<string | null>(null);
  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paymentMethods, setPaymentMethods] = useState<[string, string][]>([]);
  const [paymentProvider, setPaymentProvider] = useState<string | null>(null);

  const total = items.reduce((sum, item) => sum + item.product_variants.customer_price * item.quantity, 0);

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
        const labels: Record<string, string> = {
          cash_on_delivery: "Cash on delivery",
          bank_transfer: "Bank transfer",
          mobile_money: "Mobile money",
        };
        const enabled = Object.entries(methods)
          .filter(([, on]) => on)
          .map(([key]) => [key, labels[key] ?? key] as [string, string]);
        setPaymentMethods(enabled);
        setPaymentProvider(enabled[0]?.[0] ?? null);
      });
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
    setLocationError(null);
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
      setLocationError(err instanceof Error ? err.message : "Could not get your location.");
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
      setError(error.message);
      return;
    }
    setAddresses((prev) => [...prev, data]);
    setAddressId(data.id);
    setShowNewAddress(false);
  }

  async function handlePlaceOrder() {
    if (!addressId) {
      setError("Please select or add a delivery address.");
      return;
    }
    if (!paymentProvider) {
      setError("No payment method is currently available. Please try again later.");
      return;
    }
    setPlacing(true);
    setError(null);

    const { data: checkoutData, error: checkoutError } = await supabase.functions.invoke("checkout", {
      body: { address_id: addressId, payment_provider: paymentProvider },
    });

    if (checkoutError || !checkoutData) {
      // supabase-js doesn't auto-parse a non-2xx function response body into
      // error.message — it has to be read from the raw response ourselves,
      // or the specific message the function returned (e.g. "out of stock",
      // "account suspended") never reaches the user, just a generic failure.
      let message = "Checkout failed. Please try again.";
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
      setError(message);
      setPlacing(false);
      return;
    }

    // No payment gateway is connected yet — cash/bank transfer/mobile money
    // are all confirmed manually by a merchant or Tolo finance once the
    // money has actually moved (see confirm-payment), never assumed here.
    await refresh();
    setPlacing(false);
    navigate(`/orders/${checkoutData.order_id}`);
  }

  if (items.length === 0) {
    return <p className="text-gray-500">Your cart is empty.</p>;
  }

  return (
    <div className="max-w-lg">
      <h1 className="text-xl font-bold mb-4">Checkout</h1>

      <div className="bg-white border rounded-lg p-4 mb-4">
        <h2 className="font-medium mb-2">Deliver to</h2>
        {addresses.map((a) => (
          <label key={a.id} className="flex items-start gap-2 mb-2 text-sm">
            <input type="radio" checked={addressId === a.id} onChange={() => setAddressId(a.id)} />
            <span>
              <strong>{a.label ?? "Address"}</strong> — {a.recipient_name}, {a.phone}
              <br />
              📍 {a.line1}, {a.city}
              {a.latitude && <span className="text-xs text-gray-400"> (GPS confirmed)</span>}
            </span>
          </label>
        ))}

        {!showNewAddress && (
          <button onClick={() => setShowNewAddress(true)} className="text-navy text-sm font-medium mt-1">
            + Add new address
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
              {locating ? "Getting your location..." : "📍 Use my current location"}
            </button>
            {locationError && <p className="text-red-600 text-xs">{locationError}</p>}

            {form.latitude && (
              <p className="text-xs text-navy bg-navy-50 rounded-md px-3 py-2">
                📍 Location confirmed — you can still edit the details below if needed.
              </p>
            )}

            <input
              placeholder="Recipient name"
              value={form.recipient_name}
              onChange={(e) => setForm({ ...form, recipient_name: e.target.value })}
              className="w-full border rounded-md px-3 py-2 text-sm"
            />
            <input
              placeholder="Phone"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              className="w-full border rounded-md px-3 py-2 text-sm"
            />
            <input
              placeholder="Street / area"
              value={form.line1}
              onChange={(e) => setForm({ ...form, line1: e.target.value })}
              className="w-full border rounded-md px-3 py-2 text-sm"
            />
            <div className="grid grid-cols-2 gap-2">
              <input
                placeholder="City"
                value={form.city}
                onChange={(e) => setForm({ ...form, city: e.target.value })}
                className="w-full border rounded-md px-3 py-2 text-sm"
              />
              <input
                placeholder="Sub-city (optional)"
                value={form.sub_city}
                onChange={(e) => setForm({ ...form, sub_city: e.target.value })}
                className="w-full border rounded-md px-3 py-2 text-sm"
              />
            </div>
            <input
              placeholder="Landmark (optional)"
              value={form.landmark}
              onChange={(e) => setForm({ ...form, landmark: e.target.value })}
              className="w-full border rounded-md px-3 py-2 text-sm"
            />
            <button onClick={handleSaveAddress} className="text-sm bg-gray-800 text-white px-3 py-1.5 rounded-md">
              Save address
            </button>
          </div>
        )}
      </div>

      <div className="bg-white border rounded-lg p-4 mb-4">
        <h2 className="font-medium mb-2">Payment method</h2>
        {paymentMethods.length === 0 ? (
          <p className="text-sm text-red-600">No payment method is currently available.</p>
        ) : (
          paymentMethods.map(([key, label]) => (
            <label key={key} className="flex items-center gap-2 mb-1 text-sm">
              <input type="radio" checked={paymentProvider === key} onChange={() => setPaymentProvider(key)} />
              {label}
            </label>
          ))
        )}
      </div>

      <div className="bg-white border rounded-lg p-4 mb-4 flex justify-between font-semibold">
        <span>Total</span>
        <span>{total.toFixed(2)} ETB</span>
      </div>
      <p className="text-xs text-gray-400 -mt-3 mb-4">Any eligible discount is applied automatically and shown on your order confirmation.</p>

      {error && <p className="text-red-600 text-sm mb-3">{error}</p>}

      <button
        onClick={handlePlaceOrder}
        disabled={placing}
        className="w-full bg-navy text-white py-2.5 rounded-md font-medium hover:bg-navy-dark disabled:opacity-60"
      >
        {placing ? "Placing order..." : "Place order"}
      </button>
    </div>
  );
}
