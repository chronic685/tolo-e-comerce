# @tolo/api-client

Typed client for the new C# API ([chronic685/tolo-marketplace-api](https://github.com/chronic685/tolo-marketplace-api)), shared by the marketplace, merchant dashboard and admin apps. Supabase stays the default backend until cut-over; modules are moved to the API one at a time, behind switches.

## Use
```ts
// src/lib/api.ts already does this in every app
export const toloApi = createToloApi(import.meta.env);

const { data, error } = await toloApi.client.GET("/api/customer/products", { params: { query: { ... } } });
```
`data` and `error` are typed from the API's OpenAPI document (`error` is the RFC 7807 problem body).

### Per-module switch and the adapter layer
`VITE_BACKEND_<MODULE>=supabase|api` (default `supabase`). Modules: `catalogue`, `merchant-products`, `orders`, `merchant-orders`, `admin`, `finance`, `content`.

Each module gets one small adapter: an interface of what its screens need, one implementation per backend, chosen once:
```ts
export const catalogue: CatalogueBackend = toloApi.select("catalogue", {
  supabase: () => supabaseCatalogue,
  api: () => apiCatalogue(toloApi.client),
});
```
Screens import `catalogue` and never know which backend answered. Where the API lacks something a screen needs, the API implementation says so (and the PR lists it as a gap); it does not fake the data.

### Token
`toloApi.getAccessToken()` is the single source of the bearer token. For now it returns a development token from `localStorage["tolo.dev_token"]`, **in development builds only** (production builds never read it). Real sign-in stays on Supabase until Tolo's token format is known; there is no login UI for the API. To get dev tokens, run the API locally (`scripts/run-local-staging.ps1` in the API repo) and paste one in the browser console: `localStorage.setItem("tolo.dev_token", "<token>")`.

## Keeping it current
`openapi.json` is a copy of the API repo's committed document and `src/schema.d.ts` is generated from it.
```bash
npm run sync -w @tolo/api-client       # copy the latest openapi.json from the API repo (main), or pass a path to a local copy
npm run generate -w @tolo/api-client   # regenerate src/schema.d.ts
```
Commit both. CI regenerates the types and fails if `src/schema.d.ts` differs from what is committed.
