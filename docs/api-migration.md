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
| 1 | `catalogue` | marketplace home and search, shops list, storefront, product page, quick view, recently viewed | done, default `supabase` (uses the API's slug lookups, `ids=` batches, shop hours and typed query parameters) |
| 2 | `merchant-products` | merchant dashboard products | not started |
| 3 | `orders` | cart, checkout, customer orders, cancel | not started |
| 4 | `merchant-orders` | merchant orders | not started |
| 5 | `admin` | merchants, applications, accounts, categories, audit log | not started |
| 6 | `finance` | pricing, commission, payouts, returns | not started |
| 7 | `content` | banners, legal pages, dashboards, notifications (SignalR) | not started |

## Try it on your PC
Needs the API running locally first (the API repo's `docs/run-locally.md`: `powershell -ExecutionPolicy Bypass -File scripts\run-local-staging.ps1`, which creates demo shops and products and prints three **dev tokens** in its window). Leave that window open: the API is at `http://localhost:5080`.

**1. Start the customer site against it** (a second PowerShell window, in this repository's folder; the settings apply to this window only):
```powershell
$env:VITE_API_BASE_URL = "http://localhost:5080"
$env:VITE_BACKEND_CATALOGUE = "api"
npm run dev -w frontend
```
Open <http://localhost:5173>. You should see the three `[DEMO]` shops' products, a search for `hoe` finding "Leather shoes", the price filter in the filter popup, `/stores` (shops with their categories) and a shop page with its opening hours and prep time. To go back to Supabase, close the window (or `Remove-Item Env:VITE_BACKEND_CATALOGUE`) and start again.

**2. A dev token, only if a screen needs a signed-in call.** The catalogue is public, so you can skip this for the customer site. When you need one, never paste it anywhere but your own browser: in the API window, select the line under `CUSTOMER` (drag with the mouse) and press Enter to copy it; then in the site's browser tab press F12, open Console, type `localStorage.setItem("tolo.dev_token", "` , paste with Ctrl+V, type `")` and press Enter. Tokens last 12 hours and stop working each time the API script is restarted (a new key every run). Only development builds read the token.

The other apps use ports 5174 (merchant dashboard) and 5175 (admin), which the API's default CORS list already allows. Any other port needs `-CorsOrigins "http://localhost:<port>"` on the API script.

## Gaps: things a screen needs that the API does not give (yet)
Listed, not faked. Each is a candidate for a small API change.

### Module 1: catalogue
Closed since the first version, by API changes now in `openapi.json`: slug lookups (products and shops are found by slug or id, so URLs carry real slugs again), the product list's stock flag, shop name and slug, shop hours and prep time, `ids=` batches (recently viewed, ratings and shop summaries are one request each instead of one per item), shop sorting by name, and the typed query parameters (the adapter no longer uses `withQuery`). Stock counts were replaced by `in_stock` and `max_order_quantity`.

What is still missing or different:
1. **No separate store.** A shop is the merchant; `store_id` and `merchant_id` are the same value.
2. **No stock counts, by design.** "Only N left" is gone in API mode; the quantity box is limited by `max_order_quantity` (at most 10, and fewer when little is left).
3. **A shop's category pills** are derived from its first 100 products (there is no per-shop category list; the shop card's `categories` holds only three).
4. **Search default order.** The old screen searched with "newest first". In API mode a search with the default sort uses the API's relevance ranking (substring and typo tolerant: "hoe" finds "shoe"); choosing a sort overrides it.
5. **Banners** (homepage) and **reviews** are the content module and still come from Supabase in every mode.
