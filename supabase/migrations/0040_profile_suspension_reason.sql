-- Admin dashboard fix: Merchants.tsx already requires a typed reason before
-- suspending/rejecting a merchant (merchants.suspension_reason/rejection_reason,
-- migration 0029) and, separately, every merchants update is picked up by
-- merchants_log_change (migration 0030) into audit_logs. Customers.tsx and
-- Users.tsx suspend profiles with a single click and no reason anywhere.
-- Brings profiles in line with the same two-part mechanism: a reason column
-- on the row itself, plus an audit_logs trail via the same log_config_change()
-- trigger every other admin-editable table already uses.
alter table profiles add column suspension_reason text;

-- Scoped to account_status changes only (unlike merchants_log_change, which
-- logs every merchants update) — profiles are written far more often than
-- merchants, including routine self-service edits (name/phone/avatar) that
-- have nothing to do with an admin action and would otherwise flood the
-- audit log with noise no one asked to see there.
create trigger profiles_log_change
  after update on profiles
  for each row
  when (old.account_status is distinct from new.account_status)
  execute function log_config_change();
