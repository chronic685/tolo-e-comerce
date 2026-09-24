#!/usr/bin/env bash
# CI only: prepares the throwaway local Supabase that `supabase start` spins
# up inside the GitHub Actions runner, so the backend suite never needs the
# live project. Refuses to run against anything that isn't localhost.
#
# Everything here exists only in that local database, which is destroyed
# when the job ends:
#   1. QA staff account -> admin tier. prevent_role_self_escalation only lets
#      an existing admin change role/admin_tier, and a fresh database has
#      none (on the live project this was done once by hand, see
#      tests/README.md).
#   2. A test super admin. The super-admin tests sign in as whichever
#      account holds that tier using the QA staff password; the live
#      project's real super admin is never involved.
#   3. An active delivery zone with a free-delivery threshold (the live
#      project has real zones; a fresh database has none).
#   4. A verified payment, standing in for the live project's demo order
#      (migration 0018 skips its demo data on fresh databases).
set -euo pipefail

case "${SUPABASE_URL:-}" in
  http://127.0.0.1:*|http://localhost:*) ;;
  *) echo "Refusing to bootstrap: SUPABASE_URL is not a local address (${SUPABASE_URL:-unset})." >&2; exit 1 ;;
esac
case "${DB_URL:-}" in
  postgresql://*@127.0.0.1:*|postgresql://*@localhost:*) ;;
  *) echo "Refusing to bootstrap: DB_URL is not a local database." >&2; exit 1 ;;
esac

SUPER_ADMIN_EMAIL="qa-super-admin@ci.local"
DEMO_CUSTOMER_EMAIL="qa-demo-customer@ci.local"
ALL_PAGES='["dashboard","orders","payments","merchants","products","customers","delivery_ops","pricing_rules","refunds","settlements","inventory_movements","notification_templates","support","users","audit_log","settings"]'

# Creates a confirmed login (ignoring "already registered" on re-runs) and
# prints its id.
ensure_user() {
  local email="$1" password="$2"
  curl -sS -o /dev/null -X POST "$SUPABASE_URL/auth/v1/admin/users" \
    -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$email\",\"password\":\"$password\",\"email_confirm\":true}"
  local id
  id=$(psql "$DB_URL" -tAc "select id from auth.users where email = '$email'")
  if [ -z "$id" ]; then
    echo "User $email was not created." >&2
    exit 1
  fi
  echo "$id"
}

STAFF_ID=$(ensure_user "$QA_STAFF_EMAIL" "$QA_STAFF_PASSWORD")
SUPER_ID=$(ensure_user "$SUPER_ADMIN_EMAIL" "$QA_STAFF_PASSWORD")
DEMO_CUSTOMER_ID=$(ensure_user "$DEMO_CUSTOMER_EMAIL" "ci-demo-customer-password")

psql "$DB_URL" -v ON_ERROR_STOP=1 <<SQL
begin;
alter table public.profiles disable trigger profiles_prevent_role_escalation;

update public.profiles
set role = 'tolo_admin', admin_tier = 'admin', account_status = 'active', permissions = '$ALL_PAGES'::jsonb
where id = '$STAFF_ID';

update public.profiles
set role = 'tolo_admin', admin_tier = 'super_admin', account_status = 'active', permissions = '$ALL_PAGES'::jsonb
where id = '$SUPER_ID';

alter table public.profiles enable trigger profiles_prevent_role_escalation;

insert into public.delivery_zones (name, center_latitude, center_longitude, radius_km, delivery_fee, free_delivery_threshold, is_active)
select 'CI TEST zone', 20.0, 20.0, 2, 75, 1000, true
where not exists (select 1 from public.delivery_zones where name = 'CI TEST zone');

insert into public.addresses (customer_id, label, recipient_name, phone, line1, city, country, is_default)
select '$DEMO_CUSTOMER_ID', 'CI demo', 'CI Demo Customer', '+251900000009', 'CI Demo Address', 'Addis Ababa', 'ET', true
where not exists (select 1 from public.addresses where customer_id = '$DEMO_CUSTOMER_ID');

insert into public.orders (customer_id, address_id, subtotal, total, payment_status)
select '$DEMO_CUSTOMER_ID', a.id, 100, 100, 'paid'
from public.addresses a
where a.customer_id = '$DEMO_CUSTOMER_ID'
  and not exists (select 1 from public.orders where customer_id = '$DEMO_CUSTOMER_ID');

insert into public.payments (order_id, provider, amount, status)
select o.id, 'demo', 100, 'verified'
from public.orders o
where o.customer_id = '$DEMO_CUSTOMER_ID'
  and not exists (select 1 from public.payments p where p.order_id = o.id);
commit;
SQL

echo "Local CI fixtures ready: admin $STAFF_ID, super admin $SUPER_ID, delivery zone, verified payment."
