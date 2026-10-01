// Starting an online payment: asks the gateway for a hosted-checkout URL and
// logs the attempt. Used by checkout (first attempt) and payment-initiate
// (retry from the order page), so both behave identically.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { PaymentProvider } from "./payment_providers.ts";

export interface StartablePayment {
  id: string;
  order_id: string;
  amount: number;
  currency: string;
}

export interface GatewayCustomer {
  name: string | null;
  phone: string | null;
  email: string | null;
}

export async function startGatewayPayment(
  db: SupabaseClient,
  provider: PaymentProvider,
  payment: StartablePayment,
  customer: GatewayCustomer,
  appUrl: string | null,
): Promise<{ checkoutUrl: string } | { error: string }> {
  try {
    const result = await provider.initiate({
      paymentId: payment.id,
      orderId: payment.order_id,
      amount: Number(payment.amount),
      currency: payment.currency,
      customer,
      appUrl,
    });

    const { error } = await db.from("payment_transactions").insert({
      payment_id: payment.id,
      provider_reference: result.providerReference,
      status: "pending",
      raw_response: { event: "initiated" },
      verified_at: null,
    });
    if (error) throw new Error(error.message);

    return { checkoutUrl: result.checkoutUrl };
  } catch (err) {
    // The raw error can name gateway internals or credentials problems --
    // log it for us, show the customer something safe and actionable.
    console.error("Could not start gateway payment:", err);
    return { error: "We couldn't start the online payment. You can try again from your order page." };
  }
}

export async function loadGatewayCustomer(db: SupabaseClient, userId: string, email: string | null | undefined): Promise<GatewayCustomer> {
  const { data: profile } = await db.from("profiles").select("full_name, phone").eq("id", userId).maybeSingle();
  return { name: profile?.full_name ?? null, phone: profile?.phone ?? null, email: email ?? null };
}

/** Customer-app base URL for return/hosted-page links, from the CUSTOMER_APP_URL secret. */
export function getCustomerAppUrl(): string | null {
  const raw = Deno.env.get("CUSTOMER_APP_URL")?.trim();
  return raw ? raw.replace(/\/+$/, "") : null;
}
