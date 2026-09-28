# In-app embed mode

The customer site (`frontend/`) can run inside the native app's webview. Add
`?embed=app` to any URL to turn embed mode on:

```
https://<site>/?embed=app
https://<site>/stores/some-shop?embed=app
```

## Behavior

- The site header, top/bottom navigation, and footer are hidden. A minimal
  bar with a Close button is shown instead.
- Embed mode is remembered for the browser session (`sessionStorage`), so it
  stays on after in-app navigation even once a link drops the `?embed=app`
  param. Every page is still deep-linkable on its own URL — the param only
  needs to be present once, on first load.
- Outside embed mode, none of this applies and the app bridge is a no-op.

## App bridge

`frontend/src/lib/appBridge.ts` sends events to the native app shell by
navigating to a `toloapp://` URL. All functions are no-ops when not in embed
mode.

| Event | Trigger | URL format |
|---|---|---|
| `close` | User taps the Close button shown in embed mode | `toloapp://close` |
| `order-placed` | A checkout completes successfully | `toloapp://order-placed?orderId=<id>` |
| `open-payment` | The customer chose "Pay with Tolo Wallet" and checkout succeeded | `toloapp://open-payment?orderId=<id>&amount=<amount>` |

`order-placed` and `open-payment` both fire after the order has already been
created against a real backend payment method — the wallet option is
additive, not a replacement payment provider. `open-payment`'s `amount` is
the order total in ETB, unformatted (e.g. `1050`).
