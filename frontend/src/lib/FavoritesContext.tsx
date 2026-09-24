import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { supabase } from "./supabase";
import { useAuth } from "./AuthContext";

interface FavoritesState {
  productIds: Set<string>;
  enabled: boolean;
  loading: boolean;
  isFavorite: (productId: string) => boolean;
  toggleFavorite: (productId: string) => Promise<void>;
}

const FavoritesContext = createContext<FavoritesState | undefined>(undefined);

export function FavoritesProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [productIds, setProductIds] = useState<Set<string>>(new Set());
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase
      .from("system_settings")
      .select("value")
      .eq("key", "customer_features")
      .maybeSingle()
      .then(({ data }) => {
        const features = data?.value as { favorites_enabled?: boolean } | null;
        setEnabled(features?.favorites_enabled ?? true);
      });
  }, []);

  const refresh = useCallback(async () => {
    if (!user) {
      setProductIds(new Set());
      return;
    }
    setLoading(true);
    const { data } = await supabase.from("customer_favorites").select("product_id").eq("customer_id", user.id).not("product_id", "is", null);
    setProductIds(new Set((data ?? []).map((r) => r.product_id as string)));
    setLoading(false);
  }, [user]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  function isFavorite(productId: string) {
    return productIds.has(productId);
  }

  // Was `await refresh()` -- a full re-fetch of every favorited product id
  // just to reflect the one id this call already added or removed. Heart
  // icons render on every ProductCard sharing this same context (Marketplace,
  // Storefront, ProductDetail), so this ran on every single favorite click
  // anywhere in the app; patching the Set directly is exact, since the
  // outcome is fully known from which branch ran.
  async function toggleFavorite(productId: string) {
    if (!user) return;
    if (productIds.has(productId)) {
      const { error } = await supabase.from("customer_favorites").delete().eq("customer_id", user.id).eq("product_id", productId);
      if (error) return;
      setProductIds((prev) => {
        const next = new Set(prev);
        next.delete(productId);
        return next;
      });
    } else {
      const { error } = await supabase.from("customer_favorites").insert({ customer_id: user.id, product_id: productId });
      if (error) return;
      setProductIds((prev) => new Set(prev).add(productId));
    }
  }

  return (
    <FavoritesContext.Provider value={{ productIds, enabled, loading, isFavorite, toggleFavorite }}>
      {children}
    </FavoritesContext.Provider>
  );
}

export function useFavorites() {
  const ctx = useContext(FavoritesContext);
  if (!ctx) throw new Error("useFavorites must be used within FavoritesProvider");
  return ctx;
}
