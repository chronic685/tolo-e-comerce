import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useMerchant } from "../lib/MerchantContext";
import type { WalletTransaction } from "../types";

const typeColors: Record<string, string> = {
  sale: "text-emerald-700",
  commission: "text-red-600",
  refund: "text-red-600",
  adjustment: "text-blue-600",
  settlement: "text-gray-600",
};

export function Wallet() {
  const { merchant } = useMerchant();
  const [balance, setBalance] = useState<number | null>(null);
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);

  useEffect(() => {
    if (!merchant) return;
    supabase.from("merchant_wallets").select("balance").eq("merchant_id", merchant.id).maybeSingle().then(({ data }) => {
      setBalance(data?.balance ?? 0);
    });
    supabase
      .from("wallet_transactions")
      .select("id, type, amount, balance_after, note, created_at")
      .eq("merchant_id", merchant.id)
      .order("created_at", { ascending: false })
      .then(({ data }) => setTransactions(data ?? []));
  }, [merchant]);

  return (
    <div className="max-w-xl">
      <h1 className="text-xl font-bold mb-4">Wallet</h1>

      <div className="bg-white border rounded-lg p-6 mb-4">
        <p className="text-xs text-gray-500">Available balance</p>
        <p className="text-3xl font-bold mt-1">{balance !== null ? `${balance.toFixed(2)} ETB` : "..."}</p>
      </div>

      <div className="bg-white border rounded-lg divide-y">
        {transactions.length === 0 ? (
          <p className="text-gray-500 p-4 text-sm">No transactions yet.</p>
        ) : (
          transactions.map((t) => (
            <div key={t.id} className="flex justify-between items-center p-4">
              <div>
                <p className="text-sm font-medium capitalize">{t.type}</p>
                <p className="text-xs text-gray-500">{new Date(t.created_at).toLocaleString()}</p>
                {t.note && <p className="text-xs text-gray-400">{t.note}</p>}
              </div>
              <div className="text-right">
                <p className={`font-semibold text-sm ${typeColors[t.type] ?? ""}`}>
                  {t.amount >= 0 ? "+" : ""}
                  {t.amount.toFixed(2)} ETB
                </p>
                <p className="text-xs text-gray-400">Balance: {t.balance_after.toFixed(2)}</p>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
