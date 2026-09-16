import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/AuthContext";
import { useCart } from "../lib/CartContext";
import type { Address } from "../types";

export function Checkout() {
  const { user } = useAuth();
  const { items, refresh } = useCart();
  const navigate = useNavigate();

  const [addresses, setAddresses] = useState<Address[]>([]);
  const [addressId, setAddressId] = useState<string | null>(null);
  const [showNewAddress, setShowNewAddress] = useState(false);
  const [form, setForm] = useState({ recipient_name: "", phone: "", line1: "", city: "", label: "Home" });
  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const total = items.reduce((sum, item) => sum + item.product_variants.customer_price * item.quantity, 0);

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
  }, [user]);

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
    setPlacing(true);
    setError(null);

    const { data: checkoutData, error: checkoutError } = await supabase.functions.invoke("checkout", {
      body: { address_id: addressId, payment_provider: "demo" },
    });

    if (checkoutError || !checkoutData) {
      setError(checkoutError?.message ?? "Checkout failed");
      setPlacing(false);
      return;
    }

    // Demo payment confirmation — simulates a successful provider callback.
    // Replace with a real payment provider redirect/webhook in production.
    const { error: paymentError } = await supabase.functions.invoke(
      `payment-webhook/${checkoutData.payment_id}`,
      { body: { status: "success", reference: `demo-${checkoutData.payment_id}` } },
    );

    if (paymentError) {
      setError("Order created but payment confirmation failed. Check Order History.");
    }

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
        <h2 className="font-medium mb-2">Delivery address</h2>
        {addresses.map((a) => (
          <label key={a.id} className="flex items-start gap-2 mb-2 text-sm">
            <input type="radio" checked={addressId === a.id} onChange={() => setAddressId(a.id)} />
            <span>
              <strong>{a.label ?? "Address"}</strong> — {a.recipient_name}, {a.phone}
              <br />
              {a.line1}, {a.city}
            </span>
          </label>
        ))}

        {!showNewAddress && (
          <button onClick={() => setShowNewAddress(true)} className="text-emerald-700 text-sm font-medium mt-1">
            + Add new address
          </button>
        )}

        {showNewAddress && (
          <div className="mt-2 space-y-2">
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
              placeholder="Street address"
              value={form.line1}
              onChange={(e) => setForm({ ...form, line1: e.target.value })}
              className="w-full border rounded-md px-3 py-2 text-sm"
            />
            <input
              placeholder="City"
              value={form.city}
              onChange={(e) => setForm({ ...form, city: e.target.value })}
              className="w-full border rounded-md px-3 py-2 text-sm"
            />
            <button onClick={handleSaveAddress} className="text-sm bg-gray-800 text-white px-3 py-1.5 rounded-md">
              Save address
            </button>
          </div>
        )}
      </div>

      <div className="bg-white border rounded-lg p-4 mb-4 flex justify-between font-semibold">
        <span>Total</span>
        <span>{total.toFixed(2)} ETB</span>
      </div>

      {error && <p className="text-red-600 text-sm mb-3">{error}</p>}

      <button
        onClick={handlePlaceOrder}
        disabled={placing}
        className="w-full bg-emerald-600 text-white py-2.5 rounded-md font-medium hover:bg-emerald-700 disabled:opacity-60"
      >
        {placing ? "Placing order..." : "Place order"}
      </button>
    </div>
  );
}
