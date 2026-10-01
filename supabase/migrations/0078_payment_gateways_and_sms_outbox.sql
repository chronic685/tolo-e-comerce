-- Groundwork for online payment gateways (Chapa, Telebirr) and a log of every
-- SMS the platform sends. Neither gateway nor a real SMS provider is connected
-- yet; both run against mock providers until credentials exist (see
-- docs/integration/payments-and-sms.md), but the data model is final.

-- 1. Two new payment methods, OFF by default. checkout refuses an online
--    gateway method that has no gateway connected, so switching one on in
--    Settings early is harmless, but nothing should surface them until then.
--    Existing keys win over the defaults in this merge, so re-running this or
--    running it after someone already saved the setting changes nothing.
update system_settings
set value = '{"chapa": false, "telebirr": false}'::jsonb || value
where key = 'payment_methods';

-- 2. SMS log. Every send attempt (mock, live, failed) writes one row from the
--    Edge Functions (service role). Login codes are stored as "[redacted]"
--    (see _shared/sms.ts), so reading this table can never expose an OTP.
create table sms_outbox (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete set null,
  phone text not null,
  body text not null,
  provider text not null,
  status text not null check (status in ('sent', 'failed', 'mock')),
  error text,
  provider_message_id text,
  event_type text,
  created_at timestamptz not null default now()
);

create index idx_sms_outbox_created_at on sms_outbox (created_at desc);
create index idx_sms_outbox_user on sms_outbox (user_id) where user_id is not null;

-- Staff who can manage Settings or Notification Templates may read the log.
-- No insert/update/delete policy exists on purpose: only the service role
-- (which bypasses RLS) writes, so a signed-in user can't forge or erase rows.
alter table sms_outbox enable row level security;

create policy sms_outbox_select_staff on sms_outbox
  for select using (has_admin_page(array['settings', 'notification_templates']));
