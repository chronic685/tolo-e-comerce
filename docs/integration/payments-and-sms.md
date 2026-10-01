# Online payments and SMS: mock mode and going live

Chapa/Telebirr payments and SMS are fully built but run against **mock providers**
until real credentials exist. Nothing here is connected to a real gateway or SMS
vendor. Going live is a small, well-defined change (see the checklist at the end).

## How it fits together

```
Payments (online gateway methods: chapa, telebirr)
  checkout ──► provider.initiate() ──► checkout_url ──► customer pays on the gateway's page
  gateway ──► payment-webhook/:payment_id ──► provider.verify() ──► handleGatewayCallback()
                                                   └─► order marked paid, stock released, merchant credited
  "Pay now" on the order page ──► payment-initiate ──► a fresh checkout_url (retry / abandoned payment)

SMS
  notify.ts / send-sms-otp ──► sendSms() ──► provider (mock | Africa's Talking) ──► row in sms_outbox
```

Code: `supabase/functions/_shared/payment_providers.ts` (interface, registry, mock),
`payment_callback.ts` (what a callback means), `sms.ts` (SMS providers + log).
Cash on delivery, bank transfer and mobile money are unchanged: a human confirms them.

## Try it in mock mode

1. Apply the migration and deploy the functions:
   `supabase db push` then
   `supabase functions deploy checkout payment-webhook payment-initiate mock-gateway send-sms-otp`
2. Set these Edge Function secrets (`supabase secrets set NAME=value`):

   | Secret | Value |
   | --- | --- |
   | `PAYMENT_GATEWAY_MODE` | `mock` |
   | `MOCK_GATEWAY_SECRET` | any long random string |
   | `CUSTOMER_APP_URL` | the customer site's address, e.g. `https://shop.example.com` |
   | `SMS_PROVIDER` | `mock` |
   | `SMS_MOCK_REVEAL_OTP` | optional: `true` to see login codes in the SMS log (mock only) |

3. In the admin dashboard, Settings, switch on **Chapa** (and/or Telebirr).
4. As a customer, check out choosing Chapa. You are sent to a test payment page
   (`/mock-gateway/:payment_id`); press "Simulate successful payment" and the order
   becomes paid, exactly as a real signed webhook would make it. "Simulate failed
   payment" fails it, and "Pay now" on the order page starts a new attempt.
5. Admin dashboard, Settings, **Recent SMS** shows every message that would have been sent.

**Never leave mock mode on once real customers pay real money on this project.**
The test page marks orders paid on a button press. With neither secret set (the
default) every Chapa/Telebirr checkout is refused and the webhook rejects everything.

## What is protected

- A callback with a bad or missing signature changes nothing (it cannot fail someone's payment).
- A "success" only counts if the gateway reports the same amount (and currency) we asked for.
- Duplicate webhook deliveries cannot credit a merchant or release stock twice (atomic claim).
- Login codes are never stored in `sms_outbox`; the log is read-only even for admins.

## Going live checklist

**Payments (per gateway, start with Chapa)**

1. Get the gateway's sandbox credentials and webhook/signature details from its docs.
2. Write the real adapter next to the mock in `payment_providers.ts` implementing
   `PaymentProvider`:
   - `initiate()` creates the transaction at the gateway and returns its hosted-page URL
     and reference. Pass the gateway a callback URL of
     `<SUPABASE_URL>/functions/v1/payment-webhook/<paymentId>` and a return URL of
     `<appUrl>/orders/<orderId>`.
   - `verify(rawBody, headers)` checks the webhook signature over the raw body, then
     confirms with the gateway's own verify API and returns `success` / `failed` /
     `pending` / `invalid` plus the amount and currency the gateway reports.
3. Register it in `resolvePaymentProviders()` (the commented example shows where) so it
   replaces the mock for that name, and set its secrets.
4. Test the whole flow in the gateway's sandbox before using real money.
5. **Remove** `PAYMENT_GATEWAY_MODE` and `MOCK_GATEWAY_SECRET`, then confirm the switch in Settings.

**SMS**

1. Set `AFRICASTALKING_USERNAME` and `AFRICASTALKING_API_KEY` (register a sender ID with the
   provider if Ethiopian carriers require one).
2. **Remove** `SMS_PROVIDER=mock`. While it is set it wins over real credentials.
3. Login codes: the Supabase Auth "Send SMS" hook must point at `send-sms-otp` (see that
   function's header for the signing secret).

## Not built yet

- **Expiry of unpaid online orders.** Stock is reserved at checkout; an online payment that is
  abandoned keeps it reserved until someone cancels the order. Needs a timeout job.
- **Refunds through the gateway.** Refunds remain a manual finance action.
- **Real Chapa/Telebirr adapters.** They need real credentials to build and test properly.
- **SMS log retention.** `sms_outbox` grows forever; add a cleanup job if volume gets large.
