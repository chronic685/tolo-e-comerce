// Supabase-backed implementation of CallbackStore (see payment_callback.ts).
// Kept apart from the decision logic so that file stays free of heavy imports.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { CallbackStore } from "./payment_callback.ts";
import { finalizePaymentFailure, finalizePaymentSuccess } from "./payment_finalize.ts";

interface PaymentRow {
  id: string;
  order_id: string;
  amount: number;
}

export function supabaseCallbackStore(db: SupabaseClient, payment: PaymentRow): CallbackStore {
  return {
    async recordTransaction(row) {
      // Throws on failure so the webhook answers 500 and the gateway retries,
      // rather than silently losing a line of the payment audit trail.
      const { error } = await db.from("payment_transactions").insert({
        payment_id: payment.id,
        provider_reference: row.providerReference,
        status: row.status,
        raw_response: row.rawResponse,
        verified_at: row.verifiedAt,
      });
      if (error) throw new Error(`Could not record payment transaction: ${error.message}`);
    },

    async claimPayment(from, to) {
      // The WHERE on status makes this the atomic "I handled it first" check.
      const { data, error } = await db.from("payments").update({ status: to }).eq("id", payment.id).in("status", from).select("id");
      if (error) throw new Error(`Could not update payment: ${error.message}`);
      return (data?.length ?? 0) > 0;
    },

    finalizeSuccess: () => finalizePaymentSuccess(db, payment),
    finalizeFailure: () => finalizePaymentFailure(db, payment),
  };
}
