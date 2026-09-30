import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Heart, Star } from "lucide-react";
import { Button, Card, CardContent, LazyImage, SkeletonPage, cn, formatCurrency, formatRelativeTime } from "@tolo/ui";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/AuthContext";
import { useCart } from "../lib/CartContext";
import { useFavorites } from "../lib/FavoritesContext";
import { RatingBadge } from "../components/RatingBadge";
import { recordProductView } from "../lib/recentlyViewed";
import type { Product } from "../types";

// merchants(...) is only fetched here, not on grid pages (Marketplace.tsx/
// Storefront.tsx's product list) — a single-product page pays for one
// merchant's rating once, where a grid of many cards would recompute the
// same merchant's aggregate once per card for no real benefit.
const PRODUCT_SELECT = `
  id, merchant_id, store_id, category_id, name, slug, description, base_price, discount_price, status,
  product_variants ( id, sku, attributes, price, discount_price, is_default, customer_price:product_variants_customer_price,
    stock_status:variant_stock_status, stock_remaining:variant_stock_remaining ),
  product_images ( id, url, is_primary, variant_id, sort_order ),
  stores ( name, slug, logo_url ),
  merchants ( avg_rating:merchants_avg_rating, review_count:merchants_review_count )
`;

interface Review {
  id: string;
  rating: number;
  comment: string | null;
  created_at: string;
}

export function ProductDetail() {
  const { slug } = useParams();
  const { user } = useAuth();
  const { addItem } = useCart();
  const { enabled: favoritesEnabled, isFavorite, toggleFavorite } = useFavorites();
  const navigate = useNavigate();

  const [product, setProduct] = useState<Product | null>(null);
  const [variantId, setVariantId] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [status, setStatus] = useState<string | null>(null);
  // User's manual pick from the thumbnail strip. Reset to null whenever the
  // variant changes so the "pick image by currently-selected variant"
  // default takes back over — browsing the gallery is a per-variant choice.
  const [selectedImageId, setSelectedImageId] = useState<string | null>(null);
  const [reviews, setReviews] = useState<Review[] | null>(null);

  useEffect(() => {
    supabase
      .from("products")
      .select(PRODUCT_SELECT)
      .eq("slug", slug)
      .eq("status", "published")
      .maybeSingle()
      .then(({ data }) => {
        const p = data as unknown as Product | null;
        setProduct(p);
        setVariantId(p?.product_variants.find((v) => v.is_default)?.id ?? p?.product_variants[0]?.id ?? null);
        if (p) recordProductView(p.id);
      });
  }, [slug]);

  // Reviews are public (reviews_public_select: using (true)) — a separate,
  // read-only query. This page only displays them; submission lives in
  // OrderDetail.tsx.
  useEffect(() => {
    if (!product) return;
    supabase
      .from("reviews")
      .select("id, rating, comment, created_at")
      .eq("product_id", product.id)
      .order("created_at", { ascending: false })
      .then(({ data }) => setReviews((data as Review[] | null) ?? []));
  }, [product?.id]);

  if (!product) return <SkeletonPage />;

  const variant = product.product_variants.find((v) => v.id === variantId);
  const galleryImages = [...product.product_images].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  const defaultImage =
    product.product_images.find((i) => i.variant_id === variantId) ??
    product.product_images.find((i) => i.is_primary) ??
    product.product_images[0];
  const image = galleryImages.find((i) => i.id === selectedImageId) ?? defaultImage;
  const price = variant?.customer_price ?? 0;
  const outOfStock = variant?.stock_status === "out_of_stock";

  async function handleAddToCart() {
    if (!user) {
      navigate("/login");
      return;
    }
    if (!variantId) return;
    setStatus("adding");
    await addItem(variantId, quantity);
    setStatus("added");
    setTimeout(() => setStatus(null), 1500);
  }

  function handleSelectVariant(id: string) {
    setVariantId(id);
    setSelectedImageId(null);
  }

  function cartControls(className?: string) {
    return (
      <div className={cn("flex items-center gap-3", className)}>
        <input
          type="number"
          min={1}
          max={variant?.stock_remaining ?? undefined}
          value={quantity}
          onChange={(e) => setQuantity(Math.max(1, Number(e.target.value)))}
          disabled={outOfStock}
          className="w-20 border rounded-md px-2 py-1.5 disabled:opacity-60"
        />
        <Button onClick={handleAddToCart} disabled={status === "adding" || outOfStock} className="flex-1 md:flex-none">
          {outOfStock ? "Out of stock" : status === "added" ? "Added!" : "Add to cart"}
        </Button>
      </div>
    );
  }

  return (
    // Extra bottom padding (mobile only) so the sticky add-to-cart bar below
    // never covers the last bit of content — on top of Layout.tsx's own
    // pb-24 that already reserves space for its bottom tab bar.
    <div className="pb-24 md:pb-0">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <div>
          <LazyImage src={image?.url} alt={product.name} aspect="aspect-square" className="rounded-lg" />
          {galleryImages.length > 1 && (
            <div className="flex gap-2 mt-3 overflow-x-auto">
              {galleryImages.map((img) => (
                <button
                  key={img.id}
                  onClick={() => setSelectedImageId(img.id)}
                  aria-label="View image"
                  className={cn(
                    "flex-shrink-0 rounded-md overflow-hidden border-2 transition-colors",
                    image?.id === img.id ? "border-navy" : "border-transparent",
                  )}
                >
                  <LazyImage src={img.url} alt="" aspect="aspect-square" className="w-16 h-16 rounded-md" />
                </button>
              ))}
            </div>
          )}
        </div>

        <div>
          <div className="flex items-start justify-between gap-2">
            <h1 className="text-2xl font-bold">{product.name}</h1>
            {favoritesEnabled && user && (
              <button
                onClick={() => toggleFavorite(product.id)}
                aria-label={isFavorite(product.id) ? "Remove from favorites" : "Add to favorites"}
                className="flex-shrink-0"
              >
                <Heart className={`w-6 h-6 ${isFavorite(product.id) ? "fill-current text-red-500" : "text-gray-400"}`} />
              </button>
            )}
          </div>

          {product.stores && (
            <Link to={`/stores/${product.stores.slug}`} className="block mt-3">
              <Card className="hover:border-navy transition-colors">
                <CardContent className="p-3 flex items-center gap-3">
                  <LazyImage
                    src={product.stores.logo_url}
                    alt={product.stores.name}
                    aspect="aspect-square"
                    className="w-10 h-10 rounded-full flex-shrink-0"
                  />
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{product.stores.name}</p>
                    <RatingBadge avgRating={product.merchants?.avg_rating ?? null} reviewCount={product.merchants?.review_count ?? 0} />
                  </div>
                </CardContent>
              </Card>
            </Link>
          )}

          <p className="text-xl font-semibold text-navy mt-4">{formatCurrency(price)}</p>
          {outOfStock && <p className="text-sm font-medium text-red-600 mt-1">Out of stock</p>}
          {variant?.stock_status === "low" && variant.stock_remaining != null && (
            <p className="text-sm font-medium text-orange-600 mt-1">Only {variant.stock_remaining} left</p>
          )}
          {product.description && <p className="text-gray-600 mt-4">{product.description}</p>}

          {product.product_variants.length > 1 && (
            <div className="mt-5">
              <p className="text-sm font-medium mb-2">Variant</p>
              <div className="flex gap-2 flex-wrap">
                {product.product_variants.map((v) => (
                  <button
                    key={v.id}
                    onClick={() => handleSelectVariant(v.id)}
                    className={cn(
                      "px-3 py-1.5 rounded-full border text-sm font-medium transition-colors",
                      variantId === v.id
                        ? "bg-navy text-white border-navy"
                        : "bg-white text-gray-700 border-gray-300 hover:border-navy",
                    )}
                  >
                    {Object.values(v.attributes).join(" / ") || v.sku}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Inline on desktop; the mobile equivalent is the fixed bar below. */}
          <div className="hidden md:block mt-6">{cartControls()}</div>
        </div>
      </div>

      {reviews && reviews.length > 0 && (
        <div className="mt-8 border-t pt-6">
          <h2 className="text-lg font-semibold mb-4">Reviews</h2>
          <div className="space-y-4">
            {reviews.map((r) => (
              <div key={r.id} className="border-b pb-4 last:border-b-0 last:pb-0">
                <div className="flex items-center gap-2">
                  <div className="flex">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <Star key={n} className={cn("w-3.5 h-3.5", n <= r.rating ? "fill-amber-400 text-amber-400" : "text-gray-200")} />
                    ))}
                  </div>
                  <span className="text-xs text-gray-400">{formatRelativeTime(r.created_at)}</span>
                </div>
                {r.comment && <p className="text-sm text-gray-700 mt-1">{r.comment}</p>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Sticky add-to-cart bar — phones only. Sits just above Layout.tsx's
          own fixed bottom tab bar (~56px incl. its safe-area padding) so the
          two don't overlap. */}
      <div
        className="md:hidden fixed inset-x-0 bottom-14 z-20 bg-white border-t px-4 py-3"
        style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom, 0px))" }}
      >
        {cartControls("max-w-md mx-auto")}
      </div>
    </div>
  );
}
