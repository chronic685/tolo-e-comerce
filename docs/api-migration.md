# Moving the apps from Supabase to the C# API

The three React apps are being re-pointed, one module at a time, from Supabase to the new API ([chronic685/tolo-marketplace-api](https://github.com/chronic685/tolo-marketplace-api)). **Supabase stays the default** for every module until the owner says cut over; a module only uses the API when its switch says so.

## How it works
* `packages/api-client` (`@tolo/api-client`): the typed client, generated from the API's committed `openapi.json` (see its README).
* `VITE_API_BASE_URL` (default `http://localhost:5080`) and one switch per module, `VITE_BACKEND_<MODULE>=supabase|api` (default `supabase`). Modules: `catalogue`, `merchant-products`, `orders`, `merchant-orders`, `admin`, `finance`, `content`. See each app's `.env.example`.
* One adapter per module, in `src/data/<module>/`: `types.ts` (an interface of what the screens need), `supabase.ts` (the existing queries, moved there unchanged), `api.ts` (the C# API), `index.ts` (picks one with `toloApi.select`). Screens import the adapter and never know which backend answers. Each implementation has tests (`supabase.test.ts` against a fake client, `api.test.ts` against a mocked `fetch`), and `index.test.ts` proves the switch.
* Token: `toloApi.getAccessToken()` returns a dev token from `localStorage["tolo.dev_token"]` in development builds only. Sign-in stays on Supabase; there is no login UI for the API. Without a token the API only serves anonymous browsing.
* Tests never touch the live Supabase or the network: mocks, or the local API.

## Status
| # | Module | Screens | Status |
|---|---|---|---|
| 1 | `catalogue` | marketplace home and search, shops list, storefront, product page, quick view, recently viewed | adapter in place, default `supabase` |
| 2 | `merchant-products` | merchant dashboard products | not started |
| 3 | `orders` | cart, checkout, customer orders, cancel | not started |
| 4 | `merchant-orders` | merchant orders | not started |
| 5 | `admin` | merchants, applications, accounts, categories, audit log | not started |
| 6 | `finance` | pricing, commission, payouts, returns | not started |
| 7 | `content` | banners, legal pages, dashboards, notifications (SignalR) | not started |

## Gaps: things a screen needs that the API does not give (yet)
Listed, not faked. Each is a candidate for a small API change.

### Module 1: catalogue
1. **Query parameters are not in the OpenAPI document.** The list endpoints read `q`, `category_id`, `min_price`, `page`, ... from the query string, so the generated client cannot type them. The adapter uses `withQuery(...)`; once the API declares them the types will check the calls.
2. **No slug lookups.** Products and shops are fetched by id (`GET /products/{id}`, `/merchants/{id}`), while the screens use slugs in URLs. In API mode the adapter puts the id in the `slug` field, so URLs become `/products/<id>` and `/stores/<id>`; old slug links do not resolve in API mode.
3. **No separate store.** A shop is the merchant; `store_id` and `merchant_id` are the same value.
4. **Product list has no variants or stock.** Cards cannot show "out of stock / only N left" in API mode (the product page can: it has variants and stock, which the adapter turns into in stock / low / out so raw stock never reaches the customer).
5. **Product list has no store name**, so the card's store link is missing in API mode.
6. **No batch lookups**: merchant ratings (one request per distinct merchant, cached for the session; listing shops fills the cache), recently viewed (one request per id), shop card summaries (one products request per shop on the page), and a shop's category pills (derived from its first 100 products).
7. **Public merchant has no operating hours or prep time.** The storefront shows "open now" from the server but cannot show today's hours or the preparation time.
8. **Sorting shops by name** is not offered (the Supabase list is name-ordered); shops come back in the API's default order.
9. **Search default order.** The old screen searched with "newest first". In API mode a search with the default sort uses the API's relevance ranking (substring and typo tolerant: "hoe" finds "shoe"); choosing a sort overrides it.
10. **Banners** (homepage) are the content module and still come from Supabase in every mode.
