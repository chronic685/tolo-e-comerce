# Tolo data: what we assume, what we need, and questions for Tolo's developer

The C# backend must match Tolo's MongoDB for anything about Tolo's customers, merchants and drivers. We have not seen that
schema, so the backend **guesses no field names**. Everything Tolo-owned sits behind three interfaces in
`Tolo.Domain/Tolo/Directories.cs` (`IToloCustomerDirectory`, `IToloMerchantDirectory`, `IToloDriverDirectory`), implemented
today only by fakes in `Tolo.Infrastructure/Fakes`. When the schema arrives, one adapter per interface maps their documents
to our small records; nothing else changes.

## What the code assumes today (all replaceable)

| Assumption | Where | If wrong |
|---|---|---|
| Tolo ids are opaque strings (a Mongo `ObjectId` is 24 hex characters, but nothing depends on that) | `ToloCustomer.ToloId` etc. | None needed, it is a string |
| Tolo tokens are standard JWTs: user in `sub`, verified phone in `phone_number` or `phone` | `JwtIdentityProvider` | Change the claim names in one place |
| Tokens are verified with an issuer, audience and an HS256 secret or a JWKS URL | `TOLO_JWT_*` env | Add the right algorithm / key source |
| A Tolo user maps to a marketplace account through the verified phone and `tolo_phone_links` | `PrincipalResolver` | Replace the mapping rule |
| A uuid `sub` is a marketplace profile id (how Supabase tokens work) | `PrincipalResolver` | Drop once Supabase auth is retired |
| The directory can find a customer by Tolo id and by phone | `IToloCustomerDirectory` | Change the interface |

## Extra columns we may need (proposals only, no migration is written or applied)

The database stays as it is. The existing mapping is `tolo_phone_links (user_id, phone)`. Depending on the answers below we
may want, **only if** the phone is not enough to link a Tolo record to a marketplace row:

| Table | Proposed column | Why | Needed only if |
|---|---|---|---|
| `tolo_phone_links` | `tolo_user_id text unique null` | Link by Tolo id instead of (or as well as) phone | Phone numbers can change or be shared |
| `merchants` | `tolo_merchant_id text unique null` | Tie a marketplace merchant to Tolo's merchant master record | Tolo owns merchant master data |
| `profiles` or a new link table | `tolo_customer_id text unique null` | Tie a customer to Tolo's customer document | The phone cannot identify a customer |
| `delivery_jobs` | `tolo_driver_id text null` (today only an opaque `driver_ref`) | Tie jobs to Tolo drivers | We must show or report on drivers |

Until Tolo answers, these ids stay in the fake layer.

## Questions for Tolo's developer

### Data shapes
1. What does a **user** document look like in Mongo (collection name, fields, indexes)? Is there one `users` collection with a
   role field, or separate collections for customers, merchants and drivers?
2. What is the `_id` format for users, customers, merchants and drivers (ObjectId, UUID, string)? Is it stable forever?
3. Which fields hold a person's **verified phone** and display name? Is the phone always stored in one format, and can it change?
4. Can two Tolo records share a phone number (for example a customer who is also a driver)?
5. What does a **merchant** document hold (business name, owner, address, coordinates, category, status)? Which statuses exist?
6. What does a **driver** document hold, and which parts may we see (name, phone, vehicle)? Today we only store an opaque reference.

### Ownership
7. **Who owns merchant master data**: Tolo's Mongo or the marketplace's Postgres? If both exist, which wins on conflict, and how
   do the two stay in step?
8. Who owns the customer's profile (name, phone, addresses) once a customer exists in both systems?
9. Who creates a merchant account: the marketplace application flow (today) or Tolo?

### Authentication
10. What token do Tolo apps hold: JWT, opaque session id, something else? Who issues it?
11. For a JWT: algorithm, issuer, audience, which claims (`sub`, phone, roles?), lifetime, and how do we get the verification
    key (shared secret, public key, JWKS URL)? How are keys rotated?
12. Are Tolo's admins and staff authenticated through the same tokens? If so, how do they differ from customers?
13. How does the Tolo app hand a signed-in user to the marketplace web view today (the one-time `code` flow in
    `docs/integration/tolo-app.md`), and does that stay?

### Events and APIs
14. Which **events or webhooks** will Tolo send us (delivery job accepted, picked up, delivered, failed, driver reassigned,
    customer or merchant changed)? Payload shapes, retry policy, signing/authentication, ordering guarantees?
15. Which **APIs can we call** on Tolo (verify a code, look up a customer or merchant, create a delivery job, cancel one)? Base
    URL, authentication, rate limits, idempotency, error codes?
16. Is there a sandbox or test environment, and test data we can use without touching production?
17. What are the availability expectations (SLA) and the expected volume (jobs per hour at peak)?
