#!/usr/bin/env bash
# CI only: prepares the throwaway local Supabase that `supabase start` spins
# up inside the GitHub Actions runner, so the backend suite never needs the
# live project. Refuses to run against anything that isn't localhost.
#
# The one thing the suite's own fixture setup (tests/fixtures/
# ensureQaFixtures.ts) can't do on a fresh database is make the QA staff
# account an admin: prevent_role_self_escalation only lets an existing admin
# change role/admin_tier, and a fresh database has none. On the live project
# that was done once by hand (see tests/README.md); here it's done the same
# way, against a database that is destroyed when the job ends.
set -euo pipefail

case "${SUPABASE_URL:-}" in
  http://127.0.0.1:*|http://localhost:*) ;;
  *) echo "Refusing to bootstrap: SUPABASE_URL is not a local address (${SUPABASE_URL:-unset})." >&2; exit 1 ;;
esac
case "${DB_URL:-}" in
  postgresql://*@127.0.0.1:*|postgresql://*@localhost:*) ;;
  *) echo "Refusing to bootstrap: DB_URL is not a local database." >&2; exit 1 ;;
esac

# Create the QA staff login (ignore "already registered" on re-runs).
curl -sS -o /dev/null -X POST "$SUPABASE_URL/auth/v1/admin/users" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$QA_STAFF_EMAIL\",\"password\":\"$QA_STAFF_PASSWORD\",\"email_confirm\":true}"

STAFF_ID=$(psql "$DB_URL" -tAc "select id from auth.users where email = '$QA_STAFF_EMAIL'")
if [ -z "$STAFF_ID" ]; then
  echo "QA staff user was not created." >&2
  exit 1
fi

psql "$DB_URL" -v ON_ERROR_STOP=1 <<SQL
begin;
alter table public.profiles disable trigger profiles_prevent_role_escalation;
update public.profiles
set role = 'tolo_admin',
    admin_tier = 'admin',
    account_status = 'active',
    permissions = '["dashboard","orders","payments","merchants","products","customers","delivery_ops","pricing_rules","refunds","settlements","inventory_movements","notification_templates","support","users","audit_log","settings"]'::jsonb
where id = '$STAFF_ID';
alter table public.profiles enable trigger profiles_prevent_role_escalation;
commit;
SQL

echo "QA staff account $STAFF_ID promoted to admin tier on the local CI database."
