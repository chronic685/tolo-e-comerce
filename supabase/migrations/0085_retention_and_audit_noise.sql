-- Three things that only ever grew on the live project, found in a usage audit:
--
--   cron.job_run_details   20,034 rows / 3.4 MB: pg_cron records every run and
--                          never prunes; escalate-unacknowledged-orders alone
--                          runs every minute (1,440 rows a day).
--   audit_logs             5,001 rows / 4.5 MB, the biggest public table. 98% of
--                          its rows have no actor (written with the service role
--                          by the test suite and fixtures), mostly
--                          system_settings / discount_rules / commission_rules
--                          being toggled and restored by tests.
--   notifications          4,109 rows, 65% to the QA accounts.
--
-- 1. log_config_change() no longer logs (a) service-role writes (auth.uid() is
--    null, so there is no "who") to the pure config tables, and (b) changes to an
--    is_test merchant's own row. Every change made by a signed-in admin, and every
--    change to profiles / financial_adjustments / a real merchant, is still logged.
-- 2. prune_old_operational_rows() deletes what has no further use, and a daily
--    pg_cron job runs it.
create or replace function log_config_change()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  -- Config tables that are only noise when written without a signed-in user.
  if auth.uid() is null
     and tg_table_name in ('system_settings', 'discount_rules', 'commission_rules', 'delivery_zones', 'notification_templates') then
    return new;
  end if;

  -- The QA fixture merchants (migration 0079) are exercised constantly by tests.
  if tg_table_name = 'merchants' and coalesce((to_jsonb(new)->>'is_test')::boolean, false) then
    return new;
  end if;

  -- NEW/OLD are generic RECORD here (this function triggers on several
  -- tables with different columns): go through to_jsonb()->>'field' rather
  -- than new.field directly (see migration 0026).
  insert into audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(),
    lower(tg_op),
    tg_table_name,
    nullif(to_jsonb(new)->>'id', '')::uuid,
    jsonb_build_object(
      'before', case when tg_op = 'INSERT' then null else to_jsonb(old) end,
      'after', to_jsonb(new),
      'key', to_jsonb(new)->>'key'
    )
  );
  return new;
end;
$$;

-- Retention, in one place so the schedule and the tests agree:
--   pg_cron run history  7 days   (only for debugging recent runs)
--   audit_logs           180 days (admin accountability; the human-written rows
--                                  are a handful a week)
--   notifications        90 days, and only once read (unread ones stay)
create or replace function prune_old_operational_rows()
returns table (cron_runs_deleted int, audit_logs_deleted int, notifications_deleted int)
language plpgsql security definer set search_path = public
as $$
declare
  v_cron int := 0;
  v_audit int;
  v_notifications int;
begin
  -- pg_cron's own table: only there where the extension is installed.
  if to_regclass('cron.job_run_details') is not null then
    execute 'delete from cron.job_run_details where end_time < now() - interval ''7 days''';
    get diagnostics v_cron = row_count;
  end if;

  delete from audit_logs where created_at < now() - interval '180 days';
  get diagnostics v_audit = row_count;

  delete from notifications where is_read and created_at < now() - interval '90 days';
  get diagnostics v_notifications = row_count;

  return query select v_cron, v_audit, v_notifications;
end;
$$;

revoke execute on function prune_old_operational_rows() from public, anon, authenticated;
grant execute on function prune_old_operational_rows() to service_role;

-- Daily at 03:17 UTC. Unscheduled first so re-running the migration is safe.
do $$
begin
  if to_regnamespace('cron') is not null then
    perform cron.unschedule(jobid) from cron.job where jobname = 'prune-old-operational-rows';
    perform cron.schedule('prune-old-operational-rows', '17 3 * * *', 'select prune_old_operational_rows();');
  end if;
end;
$$;
