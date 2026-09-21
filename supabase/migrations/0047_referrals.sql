-- Customer referral system, wiring up the previously-dead
-- customer_features.referrals_enabled toggle (migration 0026). No referral
-- schema or logic existed anywhere in this app before this migration --
-- confirmed via a repo-wide grep before writing any of this.
--
-- 1. Schema: a shareable code + who-referred-whom, both on profiles --------
-- Kept to exactly what the task asked for: a generated code per customer,
-- and a nullable pointer to the referring customer. No separate
-- "referrals" table -- there is nothing to track per-referral beyond this
-- one relationship (the reward itself is a discount_rules row, tracked
-- there instead of a parallel ledger).

alter table profiles add column referral_code text;
alter table profiles add column referred_by uuid references profiles(id);
-- Set once the referrer's reward has actually been generated for this
-- specific referred signup -- the idempotency guard against a retried or
-- double-fired payment-confirmation webhook granting the same reward twice.
alter table profiles add column referral_rewarded_at timestamptz;

create unique index idx_profiles_referral_code on profiles(referral_code) where referral_code is not null;
create index idx_profiles_referred_by on profiles(referred_by) where referred_by is not null;

-- Abuse guard requested explicitly: "at minimum don't let someone generate
-- a code that credits their own account." Self-referral can't normally
-- happen through signup (a brand-new profile can't yet know its own code),
-- but this is a DB-level constraint so it holds regardless of the write
-- path -- a future admin tool, a script, a bug -- not just the one flow
-- this migration adds.
alter table profiles add constraint profiles_no_self_referral check (referred_by is null or referred_by <> id);

-- Random 8-char code with a uniqueness retry loop, not derived from the
-- profile id -- deriving from the id would risk a truncated-prefix
-- collision failing profile creation outright for the unlucky customer.
-- Retrying here is a plain read-then-check loop, not a real bottleneck at
-- this table's write rate (one call per signup).
create or replace function generate_referral_code()
returns text
language plpgsql
as $$
declare
  v_code text;
begin
  loop
    v_code := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));
    exit when not exists (select 1 from profiles where referral_code = v_code);
  end loop;
  return v_code;
end;
$$;

-- No legitimate direct caller: a customer already gets their own code from
-- their own profile row, and this has no side effects worth exposing.
-- Same "least privilege, not a reaction to a specific exploit" reasoning
-- migration 0035 already applied to haversine_km.
revoke execute on function generate_referral_code() from public, anon, authenticated;

-- handle_new_user() only assigns a code going forward -- every customer who
-- signed up before this migration would otherwise have referral_code stuck
-- at null forever and never see their "Refer a friend" link on Account.tsx.
do $$
declare
  v_profile record;
begin
  for v_profile in select id from profiles where referral_code is null loop
    update profiles set referral_code = generate_referral_code() where id = v_profile.id;
  end loop;
end;
$$;

-- Separate generator, deduping against discount_rules.code instead of
-- profiles.referral_code -- the reward step below needs a fresh promo code
-- in that other table's namespace, and reusing generate_referral_code()
-- there would only guarantee uniqueness against the wrong table (it could
-- collide with an existing admin-created or previously-issued referral
-- discount code, since that codebase never checks discount_rules at all).
create or replace function generate_discount_code()
returns text
language plpgsql
as $$
declare
  v_code text;
begin
  loop
    v_code := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));
    exit when not exists (select 1 from discount_rules where code = v_code);
  end loop;
  return v_code;
end;
$$;

revoke execute on function generate_discount_code() from public, anon, authenticated;

-- 2. Signup: capture referred_by from an optional code in user metadata ---
-- Signup.tsx passes a typed-in or link-derived code as
-- options.data.referral_code (raw_user_meta_data), same mechanism already
-- used for full_name. An unrecognized/malformed code is silently ignored
-- (referred_by stays null) rather than blocking signup -- a bad referral
-- code should never be able to stop someone from creating an account.
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_input_code text := nullif(upper(trim(new.raw_user_meta_data->>'referral_code')), '');
  v_referred_by uuid;
begin
  if v_input_code is not null then
    select id into v_referred_by from profiles where referral_code = v_input_code;
  end if;

  insert into public.profiles (id, full_name, referral_code, referred_by)
  values (new.id, new.raw_user_meta_data->>'full_name', generate_referral_code(), v_referred_by);
  return new;
end;
$$;

-- 3. Reward: reuse discount_rules instead of inventing a parallel credit
-- system (there is no customer wallet in this schema) -----------------
-- A generated code needs to be identifiable as "this specific customer's
-- reward" so Account.tsx can list it -- discount_rules had no owner/
-- beneficiary concept before this, and discount_rules_select is public
-- read (`using (true)`, migration 0026), which would otherwise let anyone
-- enumerate every customer's referral codes. This column plus an RLS
-- change below closes that without touching redemption at all: a coded
-- discount already works for whoever has the code (same trust model as
-- every other promo code from this session), this only controls who can
-- see the row exists.
alter table discount_rules add column reward_for_customer_id uuid references profiles(id);
create index idx_discount_rules_reward_for_customer on discount_rules(reward_for_customer_id) where reward_for_customer_id is not null;

drop policy if exists "discount_rules_select" on discount_rules;
create policy "discount_rules_select" on discount_rules
  for select using (reward_for_customer_id is null or reward_for_customer_id = auth.uid() or is_tolo_staff());

-- "Converts" = the referred customer's first order is actually paid for --
-- the same bright line finalizePaymentSuccess() already uses to release
-- stock and credit the merchant's wallet (payment_finalize.ts), not
-- "placed an order" (trivially farmable by creating and abandoning carts)
-- and not "an order reaches merchant_order status='completed'" (a
-- per-merchant, per-line status that doesn't cleanly generalize across a
-- multi-merchant cart). Called from finalizePaymentSuccess() for both real
-- payment paths (confirm-payment, payment-webhook).
--
-- usage_limit=1 is the single-use cap the task asked to check for -- it's
-- the same column already relied on by the promo-code work this session,
-- not new limiting logic. Idempotency against a repeated call (e.g. a
-- retried webhook) is the referred customer's own referral_rewarded_at,
-- checked before anything is created.
create or replace function process_referral_conversion(p_customer_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_enabled boolean;
  v_referred_by uuid;
  v_already_rewarded timestamptz;
  v_paid_order_count int;
  v_reward jsonb;
  v_kind discount_kind;
  v_amount numeric;
begin
  -- Same master-switch pattern as discounts_enabled/resolve_best_discount
  -- (migration 0026): turning the feature off stops new rewards from being
  -- generated, but never touches referred_by itself -- that relationship is
  -- just data, harmless to keep recording, and lets a re-enabled toggle
  -- pick back up for anyone who converts afterward.
  select coalesce((value ->> 'referrals_enabled')::boolean, false) into v_enabled
  from system_settings where key = 'customer_features';
  if v_enabled is false then
    return;
  end if;

  select referred_by, referral_rewarded_at into v_referred_by, v_already_rewarded
  from profiles where id = p_customer_id;

  if v_referred_by is null or v_already_rewarded is not null then
    return;
  end if;

  select count(*) into v_paid_order_count from orders
  where customer_id = p_customer_id and payment_status = 'paid';

  if v_paid_order_count <> 1 then
    return;
  end if;

  select value into v_reward from system_settings where key = 'referral_reward';
  v_kind := coalesce(nullif(v_reward->>'discount_kind', '')::discount_kind, 'fixed');
  v_amount := coalesce((v_reward->>'amount')::numeric, 50);

  insert into discount_rules (
    name, description, scope_type, discount_kind, amount, usage_limit,
    funded_by, code, is_active, reward_for_customer_id
  ) values (
    'Referral reward',
    'Thanks for referring a friend who placed their first order!',
    'platform', v_kind, v_amount, 1, 'tolo', generate_discount_code(), true, v_referred_by
  );

  update profiles set referral_rewarded_at = now() where id = p_customer_id;
end;
$$;

revoke execute on function process_referral_conversion(uuid) from public, anon, authenticated;

-- Account.tsx's "how many successful referrals" needs to read OTHER
-- customers' profile rows (the people referred_by = me) -- but
-- profiles_select_own_or_staff (migration 0014) restricts profiles SELECT
-- to "id = auth.uid() or staff", so a plain client-side query would
-- silently return zero rows for every customer. Same fix as
-- merchants_avg_rating/merchants_review_count earlier this session:
-- a narrow security-definer function that only ever returns aggregate
-- counts scoped to auth.uid() internally, never another customer's actual
-- row data (name, phone, email).
create or replace function my_referral_stats()
returns table (referred_signups bigint, successful_referrals bigint)
language sql stable security definer set search_path = public
as $$
  select count(*), count(*) filter (where referral_rewarded_at is not null)
  from profiles where referred_by = auth.uid();
$$;

-- Business-tunable reward amount, same pattern as rate_limits/delivery --
-- editable later without a code deploy even though no dedicated admin UI
-- control is added this round (same as rate_limits today).
insert into system_settings (key, value) values
  ('referral_reward', jsonb_build_object('discount_kind', 'fixed', 'amount', 50))
on conflict (key) do nothing;
