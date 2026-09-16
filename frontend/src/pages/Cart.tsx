import { Link, useNavigate } from "react-router-dom";
import { useCart } from "../lib/CartContext";

export function Cart() {
  const { items, loading, updateQuantity, removeItem } = useCart();
  const navigate = useNavigate();

  const total = items.reduce((sum, item) => sum + item.product_variants.customer_price * item.quantity, 0);

  if (loading) return <p className="text-gray-500">Loading cart...</p>;

  if (items.length === 0) {
    return (
      <div className="text-center py-16">
        <p className="text-gray-500 mb-4">Your cart is empty.</p>
        <Link to="/" className="text-emerald-700 font-medium">
          Browse the marketplace
        </Link>
      </div>
    );
  }

  return (
    <div className="grid md:grid-cols-3 gap-8">
      <div className="md:col-span-2 space-y-3">
        {items.map((item) => {
          const price = item.product_variants.customer_price;
          const attrs = Object.values(item.product_variants.attributes ?? {}).join(" / ");
          return (
            <div key={item.id} className="bg-white border rounded-lg p-4 flex items-center gap-4">
              <div className="flex-1">
                <Link to={`/products/${item.product_variants.products.slug}`} className="font-medium hover:text-emerald-700">
                  {item.product_variants.products.name}
                </Link>
                {attrs && <p className="text-xs text-gray-500">{attrs}</p>}
                <p className="text-sm text-emerald-700 font-semibold mt-1">{price.toFixed(2)} ETB</p>
              </div>
              <input
                type="number"
                min={1}
                value={item.quantity}
                onChange={(e) => updateQuantity(item.id, Number(e.target.value))}
                className="w-16 border rounded-md px-2 py-1"
              />
              <button onClick={() => removeItem(item.id)} className="text-sm text-red-600 hover:underline">
                Remove
              </button>
            </div>
          );
        })}
      </div>
      <div className="bg-white border rounded-lg p-4 h-fit">
        <div className="flex justify-between font-semibold text-lg mb-4">
          <span>Subtotal</span>
          <span>{total.toFixed(2)} ETB</span>
        </div>
        <button
          onClick={() => navigate("/checkout")}
          className="w-full bg-emerald-600 text-white py-2.5 rounded-md font-medium hover:bg-emerald-700"
        >
          Proceed to checkout
        </button>
      </div>
    </div>
  );
}
