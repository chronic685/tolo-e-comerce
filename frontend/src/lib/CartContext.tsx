import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { supabase } from "./supabase";
import { useAuth } from "./AuthContext";
import type { CartItem } from "../types";

interface CartState {
  items: CartItem[];
  loading: boolean;
  itemCount: number;
  addItem: (variantId: string, quantity: number) => Promise<void>;
  updateQuantity: (itemId: string, quantity: number) => Promise<void>;
  removeItem: (itemId: string) => Promise<void>;
  refresh: () => Promise<void>;
}

const CartContext = createContext<CartState | undefined>(undefined);

const CART_ITEM_SELECT = `
  id, cart_id, variant_id, quantity,
  product_variants (
    id, sku, attributes, price, discount_price, is_default,
    products ( id, name, slug, merchant_id )
  )
`;

export function CartProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [items, setItems] = useState<CartItem[]>([]);
  const [loading, setLoading] = useState(false);

  async function getOrCreateCart(): Promise<string | null> {
    if (!user) return null;
    const { data: existing } = await supabase
      .from("carts")
      .select("id")
      .eq("customer_id", user.id)
      .maybeSingle();
    if (existing) return existing.id;

    const { data: created, error } = await supabase
      .from("carts")
      .insert({ customer_id: user.id })
      .select("id")
      .single();
    if (error) return null;
    return created.id;
  }

  const refresh = useCallback(async () => {
    if (!user) {
      setItems([]);
      return;
    }
    setLoading(true);
    const cartId = await getOrCreateCart();
    if (!cartId) {
      setLoading(false);
      return;
    }
    const { data } = await supabase
      .from("cart_items")
      .select(CART_ITEM_SELECT)
      .eq("cart_id", cartId);
    setItems((data as unknown as CartItem[]) ?? []);
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function addItem(variantId: string, quantity: number) {
    const cartId = await getOrCreateCart();
    if (!cartId) return;

    const { data: existing } = await supabase
      .from("cart_items")
      .select("id, quantity")
      .eq("cart_id", cartId)
      .eq("variant_id", variantId)
      .maybeSingle();

    if (existing) {
      await supabase
        .from("cart_items")
        .update({ quantity: existing.quantity + quantity })
        .eq("id", existing.id);
    } else {
      await supabase.from("cart_items").insert({ cart_id: cartId, variant_id: variantId, quantity });
    }
    await refresh();
  }

  async function updateQuantity(itemId: string, quantity: number) {
    if (quantity <= 0) {
      await removeItem(itemId);
      return;
    }
    await supabase.from("cart_items").update({ quantity }).eq("id", itemId);
    await refresh();
  }

  async function removeItem(itemId: string) {
    await supabase.from("cart_items").delete().eq("id", itemId);
    await refresh();
  }

  const itemCount = items.reduce((sum, item) => sum + item.quantity, 0);

  return (
    <CartContext.Provider value={{ items, loading, itemCount, addItem, updateQuantity, removeItem, refresh }}>
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used within CartProvider");
  return ctx;
}
