import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { supabase } from "./supabase";
import { useAuth } from "./AuthContext";
import type { Merchant, Store } from "../types";

interface MerchantState {
  merchant: Merchant | null;
  store: Store | null;
  loading: boolean;
  refresh: () => Promise<void>;
}

const MerchantContext = createContext<MerchantState | undefined>(undefined);

export function MerchantProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [merchant, setMerchant] = useState<Merchant | null>(null);
  const [store, setStore] = useState<Store | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!user) {
      setMerchant(null);
      setStore(null);
      setLoading(false);
      return;
    }
    setLoading(true);

    // Owned merchant first, then staff membership.
    const { data: owned } = await supabase.from("merchants").select("*").eq("owner_id", user.id).maybeSingle();

    let m = owned;
    if (!m) {
      const { data: staffRow } = await supabase
        .from("merchant_staff")
        .select("merchant_id, merchants ( * )")
        .eq("user_id", user.id)
        .maybeSingle();
      m = (staffRow?.merchants as unknown as Merchant) ?? null;
    }

    setMerchant(m);

    if (m) {
      const { data: s } = await supabase.from("stores").select("*").eq("merchant_id", m.id).maybeSingle();
      setStore(s);
    } else {
      setStore(null);
    }

    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return <MerchantContext.Provider value={{ merchant, store, loading, refresh }}>{children}</MerchantContext.Provider>;
}

export function useMerchant() {
  const ctx = useContext(MerchantContext);
  if (!ctx) throw new Error("useMerchant must be used within MerchantProvider");
  return ctx;
}
