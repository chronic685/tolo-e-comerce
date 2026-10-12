import type { ToloClient, components } from "@tolo/api-client";
import { PRODUCT_IMAGE_PRESET, compressImage } from "@tolo/ui";
import type { Category, Product } from "../../types";
import type { ActionResult, ImageInput, LoadedProduct, MerchantProductsBackend, ProductInput, ProductTab, Removals, SaveProductResult, VariantInput } from "./types";

type Schemas = components["schemas"];
type ProductDto = Schemas["ProductDto"];
type CategoryDto = Schemas["CategoryDto"];

// What the API backend does differently from Supabase (the rest is listed as gaps in docs/api-migration.md):
//  * A shop is found from the signed-in account (GET /api/merchant/merchants); the Supabase merchant and store ids are not used.
//  * A product's status is draft, published or hidden, and "archived" is a flag. The screens' statuses are mapped: hidden is "paused".
//  * Pictures are uploaded to the API as files, after the product exists. A picture given as a link is fetched in the browser and uploaded; if the
//    link cannot be read from here the product is still saved and the picture is reported as a warning.
//  * The variants of a product are replaced as a whole; there is no low-stock threshold.

export interface ApiMerchantProductsDeps {
  client: ToloClient;
  baseUrl: string;
  getToken: () => string | null;
  /** For tests; defaults to the global fetch (used for picture uploads, which the typed client cannot send). */
  fetch?: typeof fetch;
}

const LIST_PAGE = 100;

function problemText(error: unknown, fallback: string): string {
  const e = error as { title?: string; errors?: Record<string, string[]> } | undefined;
  const firstField = e?.errors ? Object.values(e.errors)[0]?.[0] : undefined;
  return firstField ?? e?.title ?? fallback;
}

const problemCode = (error: unknown) => (error as { code?: string } | undefined)?.code;

const num = (value: unknown): number => Number(value ?? 0);

export function screenStatus(s: { status: string; is_archived: boolean }): string {
  if (s.is_archived) return "archived";
  return s.status === "hidden" ? "paused" : s.status;
}

export function mapManagedProduct(dto: ProductDto, categories: Map<string, Category>): Product {
  const s = dto.summary;
  const category = s.category_id ? categories.get(s.category_id) : undefined;
  return {
    id: s.id,
    merchant_id: s.merchant_id,
    store_id: s.merchant_id,
    category_id: s.category_id ?? null,
    name: s.name,
    slug: s.slug,
    description: dto.description ?? null,
    base_price: num(s.price),
    discount_price: s.discount_price === null || s.discount_price === undefined ? null : Number(s.discount_price),
    status: screenStatus(s),
    archived_at: dto.archive?.at ?? null,
    archived_by_role: dto.archive?.by_kind === "staff" ? "staff" : dto.archive?.by_kind === "merchant" ? "merchant" : null,
    product_variants: dto.variants.map((v) => ({
      id: v.id,
      product_id: s.id,
      sku: v.sku ?? null,
      attributes: (v.attributes ?? {}) as Record<string, string>,
      price: num(v.price),
      discount_price: v.discount_price === null || v.discount_price === undefined ? null : Number(v.discount_price),
      is_default: v.is_default,
      inventory: { stock_quantity: num(v.stock_quantity), reserved_quantity: 0, available_quantity: num(v.stock_quantity) },
    })),
    product_images: dto.images.map((i) => ({ id: i.id, url: i.url, is_primary: i.is_primary })),
    categories: category ? { name: category.name, name_am: category.name_am ?? null } : null,
  };
}

function mapCategory(c: CategoryDto): Category {
  return { id: c.id, name: c.name, name_am: c.name_am ?? null, slug: c.slug };
}

export function createApiMerchantProducts({ client, baseUrl, getToken, fetch: fetchImpl }: ApiMerchantProductsDeps): MerchantProductsBackend {
  const doFetch = (input: string, init?: RequestInit) => (fetchImpl ?? fetch)(input, init);
  let myMerchant: Promise<string | null> | null = null;
  let categoryList: Promise<Category[]> | null = null;

  /** The shop of the signed-in account: the first of the shops it works for. */
  function merchantId(): Promise<string | null> {
    myMerchant ??= client.GET("/api/merchant/merchants").then(({ data }) => {
      const id = data?.items[0]?.id ?? null;
      if (id === null) myMerchant = null; // ask again next time (not signed in yet, or no shop)
      return id;
    });
    return myMerchant;
  }

  function categories(): Promise<Category[]> {
    categoryList ??= client.GET("/api/customer/categories").then(({ data }) => (data ?? []).map(mapCategory));
    return categoryList;
  }

  async function detail(id: string): Promise<ProductDto | null> {
    const { data } = await client.GET("/api/merchant/products/{id}", { params: { path: { id } } });
    return data ?? null;
  }

  async function listPage(tab: ProductTab, page: number, pageSize: number) {
    const { data, response } = await client.GET("/api/merchant/products", { params: { query: { archived: tab === "archived", sort: "newest", page, page_size: pageSize } } });
    if (!data) {
      console.error(`GET merchant products failed: ${response.status}`);
      return { products: [] as Product[], total: 0 };
    }
    // The list has no stock counts, categories' names or archive details; the product itself does, so read each (one page of products at most).
    const [details, names] = await Promise.all([Promise.all(data.items.map((s) => detail(s.id))), categories()]);
    const byId = new Map(names.map((c) => [c.id, c]));
    return { products: details.filter((d): d is ProductDto => d !== null).map((d) => mapManagedProduct(d, byId)), total: Number(data.total) };
  }

  /** Several calls one after the other; the first one the API refuses ends it with the reason. */
  async function each(ids: string[], call: (id: string) => Promise<{ ok: true } | { ok: false; error: string }>): Promise<ActionResult> {
    for (const id of ids) {
      const result = await call(id);
      if (!result.ok) return result;
    }
    return { ok: true };
  }

  async function post(path: "/api/merchant/products/{id}/hide" | "/api/merchant/products/{id}/show" | "/api/merchant/products/{id}/restore", id: string): Promise<ActionResult> {
    const { error, response } = await client.POST(path, { params: { path: { id } } });
    return response.ok ? { ok: true } : { ok: false, error: problemText(error, `HTTP ${response.status}`) };
  }

  async function uploadImage(productId: string, blob: Blob, name: string): Promise<ActionResult> {
    const form = new FormData();
    // In a browser every Blob is this page's own. Where a blob comes from another realm (a fetched response in some test runtimes) FormData refuses it, so copy it.
    const part: Blob = blob instanceof Blob ? blob : new Blob([await new Response(blob).arrayBuffer()], { type: (blob as { type?: string }).type });
    form.append("file", part, name);
    const token = getToken();
    const response = await doFetch(`${baseUrl.replace(/\/+$/, "")}/api/merchant/products/${productId}/images`, {
      method: "POST",
      body: form,
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    if (response.ok) return { ok: true };
    const body = (await response.json().catch(() => undefined)) as unknown;
    return { ok: false, error: problemText(body, `HTTP ${response.status}`) };
  }

  const variantBody = (variants: VariantInput[], previous: Map<string, number | null>) =>
    variants.map((v) => ({
      sku: v.sku,
      attributes: v.attributes,
      price: v.price,
      // The editor has no discount field: keep the one a variant already had.
      discount_price: v.id ? (previous.get(v.id) ?? null) : null,
      is_default: v.isDefault,
      stock_quantity: v.stock,
    }));

  return {
    async list(_ref, tab, page, pageSize) {
      const { products, total } = await listPage(tab, page, pageSize);
      return { items: products, total };
    },

    async listAll(_ref, tab) {
      const all: Product[] = [];
      for (let page = 1; ; page++) {
        const { products, total } = await listPage(tab, page, LIST_PAGE);
        all.push(...products);
        if (all.length >= total || products.length === 0) return all;
      }
    },

    setVisible: (ids, visible) => each(ids, (id) => post(visible ? "/api/merchant/products/{id}/show" : "/api/merchant/products/{id}/hide", id)),

    async archive(ids) {
      let count = 0;
      for (const id of ids) {
        const { error, response } = await client.POST("/api/merchant/products/{id}/archive", { params: { path: { id } }, body: { reason: null } });
        if (!response.ok) return { ok: false, error: problemText(error, `HTTP ${response.status}`) };
        count++;
      }
      return { ok: true, count };
    },

    async restore(ids) {
      let restored = 0;
      let blocked = 0;
      for (const id of ids) {
        const result = await post("/api/merchant/products/{id}/restore", id);
        if (result.ok) restored++;
        else blocked++;
      }
      return { ok: true, restored, blocked };
    },

    // There is nothing to ask beforehand: the delete itself answers 409 product_has_orders.
    hasOrders: async () => ({ ok: true, hasOrders: false }),

    async remove(id) {
      const { error, response } = await client.DELETE("/api/merchant/products/{id}", { params: { path: { id } } });
      if (response.ok) return { ok: true };
      return { ok: false, error: problemText(error, `HTTP ${response.status}`), hasOrders: problemCode(error) === "product_has_orders" };
    },

    async load(id): Promise<LoadedProduct | null> {
      const dto = await detail(id);
      if (!dto) return null;
      const prices = dto.variants.map((v) => num(v.price));
      return {
        name: dto.summary.name,
        description: dto.description ?? null,
        categoryId: dto.summary.category_id ?? null,
        basePrice: prices.length > 0 ? Math.min(...prices) : 0,
        status: screenStatus(dto.summary),
        archivedBy: dto.archive?.by_kind === "staff" ? "staff" : dto.archive?.by_kind === "merchant" ? "merchant" : null,
        variants: dto.variants.map((v) => ({
          id: v.id,
          sku: v.sku ?? null,
          attributes: (v.attributes ?? {}) as Record<string, string>,
          price: num(v.price),
          stock: num(v.stock_quantity),
          lowStockThreshold: 5,
        })),
        images: dto.images.map((i) => ({ id: i.id, url: i.url })),
      };
    },

    categories,

    // The API gives the merchant's rate, not one per category.
    async commissionRate() {
      const { data } = await client.GET("/api/merchant/commission");
      const rate = data?.items[0]?.rate_percent;
      return rate === undefined ? null : Number(rate);
    },

    async prepareImage(_ref, file) {
      try {
        const prepared = await compressImage(file, PRODUCT_IMAGE_PRESET);
        return { ok: true, url: URL.createObjectURL(prepared), file: prepared };
      } catch {
        return { ok: false, error: "", prepareFailed: true };
      }
    },

    async save(_ref, product: ProductInput, variants: VariantInput[], images: ImageInput[], existingProductId?: string, removals?: Removals): Promise<SaveProductResult> {
      const warnings: string[] = [];
      let id = existingProductId;
      let current: ProductDto | null = null;

      if (!id) {
        const owner = await merchantId();
        if (!owner) return { ok: false, error: "No shop is linked to this account in the API." };
        const { data, error } = await client.POST("/api/merchant/merchants/{merchantId}/products", {
          params: { path: { merchantId: owner } },
          body: { category_id: product.categoryId, name: product.name, slug: product.slug, description: product.description, variants: variantBody(variants, new Map()) },
        });
        if (!data) return { ok: false, error: problemText(error, "The product could not be saved.") };
        current = data;
        id = data.summary.id;
      } else {
        current = await detail(id);
        if (!current) return { ok: false, error: "The product was not found." };
        const { data, error } = await client.PUT("/api/merchant/products/{id}", {
          params: { path: { id } },
          body: {
            category_id: product.categoryId,
            name: product.name,
            slug: product.slug,
            description: product.description,
            is_featured: current.summary.is_featured,
            is_returnable: current.summary.is_returnable,
          },
        });
        if (!data) return { ok: false, error: problemText(error, "The product could not be saved.") };
        const kept = new Map(current.variants.map((v) => [v.id, v.discount_price === null || v.discount_price === undefined ? null : Number(v.discount_price)]));
        if (variants.length > 0) {
          const replaced = await client.PUT("/api/merchant/products/{id}/variants", { params: { path: { id } }, body: variantBody(variants, kept) });
          if (!replaced.data) return { ok: false, error: problemText(replaced.error, "The variants could not be saved."), variantInUse: problemCode(replaced.error) === "variant_in_use" };
          current = replaced.data;
        } else {
          current = data;
        }
      }

      // Pictures: new ones are uploaded now that the product exists; ones already stored are left as they are.
      for (const image of images) {
        if (image.id || (!image.file && !image.url.trim())) continue;
        try {
          const blob = image.file ?? (await (await doFetch(image.url)).blob());
          const uploaded = await uploadImage(id, blob, image.file?.name ?? "photo");
          if (!uploaded.ok) warnings.push(`${image.file?.name ?? image.url}: ${uploaded.error}`);
        } catch {
          warnings.push(`${image.url}: this link could not be read from here. Upload the picture as a file instead.`);
        }
      }

      for (const imageId of removals?.imageIds ?? []) {
        const { response } = await client.DELETE("/api/merchant/products/{id}/images/{imageId}", { params: { path: { id, imageId } } });
        if (!response.ok) warnings.push(`A picture could not be removed (HTTP ${response.status}).`);
      }

      // Visibility last: showing needs a variant that can be listed.
      const live = current?.summary.status;
      if (product.status === "published" && live !== "published") {
        const shown = await post("/api/merchant/products/{id}/show", id);
        if (!shown.ok) return { ok: false, error: shown.error };
      } else if (product.status === "paused" && live === "published") {
        const hidden = await post("/api/merchant/products/{id}/hide", id);
        if (!hidden.ok) return { ok: false, error: hidden.error };
      }

      return { ok: true, productId: id, warnings: warnings.length > 0 ? warnings : undefined };
    },
  };
}
