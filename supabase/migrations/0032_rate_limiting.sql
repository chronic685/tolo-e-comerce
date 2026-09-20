-- Phase 3A: rate limiting for checkout (order creation) and review
-- submission — the two abuse-prone actions with no application-level
-- throttling today (OTP already has Supabase Auth's own rate limits; cart
-- mutations are deliberately out of scope, see the roadmap discussion).
--
-- Design: a fixed-window counter, not a row-per-hit log. One row per
-- (key, window_start) is upserted and atomically incremented via
-- `insert ... on conflict ... do update ... returning`, which Postgres
-- serializes correctly under concurrent transactions on the same conflict
-- key — two simultaneous requests for the same customer cannot both read
-- a stale count and both slip through. This is also naturally
-- self-bounding: at most one row exists per (key, window) at a time, and
-- every call opportunistically deletes that key's expired windows, so no
-- pg_cron/scheduled cleanup job is needed.

create table rate_limit_counters (
  key text not null,
  window_start timestamptz not null,
  count int not null default 1,
  primary key (key, window_start)
);
-- No separate index needed: the primary key IS the only access pattern
-- (an equality lookup on both columns via the upsert itself).

-- Customers/merchants/staff must never be able to read, insert, update, or
-- reset their own rate-limit counters directly — enable RLS with zero
-- policies (default-deny for every role). Only security-definer functions
-- below (running as the table owner) can touch this table.
alter table rate_limit_counters enable row level security;

create or replace function check_and_record_rate_limit(p_key text, p_max_count int, p_window_seconds int)
returns table (allowed boolean, retry_after_seconds int)
language plpgsql security definer set search_path = public
as $$
declare
  v_window_start timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_count int;
begin
  insert into rate_limit_counters (key, window_start, count)
  values (p_key, v_window_start, 1)
  on conflict (key, window_start) do update set count = rate_limit_counters.count + 1
  returning rate_limit_counters.count into v_count;

  delete from rate_limit_counters where key = p_key and window_start < v_window_start;

  return query select
    v_count <= p_max_count,
    greatest(0, ceil(extract(epoch from (v_window_start + make_interval(secs => p_window_seconds) - now())))::int);
end;
$$;

-- Policy values live in system_settings (the same generic config mechanism
-- already used for payment_methods/delivery/customer_features/etc.) so
-- they can be tuned without a code deploy — no new admin UI is added this
-- phase, but the values are not hard-coded either. Hard-coded fallbacks
-- below cover the case where the setting row is ever missing/malformed.
insert into system_settings (key, value) values
  ('rate_limits', jsonb_build_object(
    'checkout', jsonb_build_object('max_count', 5, 'window_seconds', 600),
    'review', jsonb_build_object('max_count', 10, 'window_seconds', 3600)
  ))
on conflict (key) do nothing;

create or replace function get_rate_limit_config(p_action text, out max_count int, out window_seconds int)
language plpgsql stable security definer set search_path = public
as $$
declare
  v_config jsonb;
begin
  select value -> p_action into v_config from system_settings where key = 'rate_limits';
  max_count := coalesce((v_config ->> 'max_count')::int, case p_action when 'checkout' then 5 when 'review' then 10 else 5 end);
  window_seconds := coalesce((v_config ->> 'window_seconds')::int, case p_action when 'checkout' then 600 when 'review' then 3600 else 600 end);
end;
$$;

-- Reviews are inserted directly via PostgREST from the customer app, not
-- through an Edge Function, so the limit has to be enforced in a trigger,
-- not in application code. Identity comes from auth.uid(), never from the
-- client-supplied customer_id column — a mismatched customer_id is
-- rejected by the existing reviews_insert_own RLS policy regardless, but
-- the rate-limit key itself must never trust client input.
--
-- The errcode 'PT429' is PostgREST's documented convention for a trigger
-- to make PostgREST answer with a specific HTTP status (here, 429) instead
-- of its default 400 for a raised exception.
--
-- Known scope of this trigger: a BEFORE INSERT trigger's writes to another
-- table are part of the same statement, so if the row is subsequently
-- rejected by RLS (e.g. the order isn't completed yet), the counter
-- increment rolls back along with it — that attempt never consumes real
-- quota. This means the limiter throttles floods of genuinely-eligible
-- reviews (the actual content-spam concern) correctly, but does not add
-- throttling on top of already-guaranteed-to-fail requests against
-- ineligible orders, which can never write data regardless. Verified with
-- both scenarios in tests/smoke/rate-limiting.test.ts.
create or replace function enforce_review_rate_limit()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_max int;
  v_window int;
  v_result record;
begin
  select max_count, window_seconds into v_max, v_window from get_rate_limit_config('review');
  select * into v_result from check_and_record_rate_limit('customer:' || auth.uid() || ':review', v_max, v_window);
  if not v_result.allowed then
    raise exception 'Too many review submissions. Please try again shortly.' using errcode = 'PT429';
  end if;
  return new;
end;
$$;

create trigger reviews_rate_limit
  before insert on reviews
  for each row execute function enforce_review_rate_limit();
