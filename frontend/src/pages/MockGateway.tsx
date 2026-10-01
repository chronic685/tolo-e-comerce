import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Button, toast } from "@tolo/ui";
import { supabase } from "../lib/supabase";

// Stand-in for the hosted payment page a real gateway (Chapa, Telebirr) shows.
// The MOCK gateway's checkout_url points here (see _shared/payment_providers.ts)
// so the whole online-payment flow -- checkout, redirect, pay, signed callback,
// order marked paid -- can be tried end to end with no gateway account and no
// real money. It only works while the backend is in mock mode
// (PAYMENT_GATEWAY_MODE=mock); otherwise the mock-gateway function answers 404
// and this page says so. It is intentionally English-only: it is a developer
// tool standing in for a third-party page, not part of the customer experience.

interface PaymentSummary {
  amount: number;
  currency: string;
  provider: string;
  status: string;
  order_id: string;
}

export function MockGateway() {
  const { paymentId } = useParams();
  const navigate = useNavigate();
  const [payment, setPayment] = useState<PaymentSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase
      .from("payments")
      .select("amount, currency, provider, status, order_id")
      .eq("id", paymentId)
      .maybeSingle()
      .then(({ data }) => {
        setPayment(data as PaymentSummary | null);
        setLoading(false);
      });
  }, [paymentId]);

  async function simulate(outcome: "success" | "failed") {
    setBusy(true);
    const { data, error } = await supabase.functions.invoke("mock-gateway", { body: { payment_id: paymentId, outcome } });
    if (error || !data?.order_id) {
      // supabase-js hides the response body on non-2xx; the 404 for "mock mode
      // is off" is the one case worth naming.
      const status = (error as { context?: Response } | null)?.context?.status;
      toast.error(status === 404 ? "The mock payment gateway is not enabled on this server." : "The mock payment could not be completed.");
      setBusy(false);
      return;
    }
    navigate(`/orders/${data.order_id}`);
  }

  if (loading) return <p className="p-6 text-sm text-gray-500">Loading...</p>;

  if (!payment) {
    return (
      <div className="max-w-md mx-auto p-6">
        <p className="text-sm">This payment could not be found.</p>
        <Link to="/orders" className="text-sm underline">
          Back to my orders
        </Link>
      </div>
    );
  }

  const open = payment.status === "pending" || payment.status === "failed";

  return (
    <div className="max-w-md mx-auto p-6 space-y-4">
      <div className="rounded-md border-2 border-dashed border-amber-500 bg-amber-50 dark:bg-amber-950/30 p-3 text-xs text-amber-900 dark:text-amber-200">
        <strong>Test payment page.</strong> This is the mock gateway: no real money moves and nothing is charged.
      </div>

      <h1 className="text-lg font-semibold">Pay with {payment.provider}</h1>
      <p className="text-3xl font-semibold">
        {Number(payment.amount).toFixed(2)} {payment.currency}
      </p>

      {open ? (
        <div className="space-y-2">
          <Button className="w-full" disabled={busy} onClick={() => simulate("success")}>
            Simulate successful payment
          </Button>
          <Button variant="destructive" className="w-full" disabled={busy} onClick={() => simulate("failed")}>
            Simulate failed payment
          </Button>
        </div>
      ) : (
        <p className="text-sm">
          This payment is already <strong>{payment.status}</strong>.{" "}
          <Link to={`/orders/${payment.order_id}`} className="underline">
            View the order
          </Link>
        </p>
      )}
    </div>
  );
}
