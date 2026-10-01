-- Raises the rate limit on the two Tolo-app login endpoints
-- (tolo-app-login, tolo-merchant-login -- both call
-- supabase/functions/_shared/tolo_login.ts's rateLimitByIp()) from 5 to 25
-- requests per 10 minutes.
--
-- Neither 'app_login' nor 'merchant_app_login' has ever had its own entry
-- in system_settings.rate_limits (migration 0032) -- get_rate_limit_config()
-- was falling through to its generic `else` case (5 per 600s), the same
-- tight default meant for a single customer/merchant hitting checkout
-- repeatedly, not for a login endpoint rate-limited by source IP. Many
-- Ethiopian mobile carriers NAT a large number of phones behind a small
-- pool of public IPs, so that default could lock out unrelated customers/
-- merchants sharing an IP after a handful of genuine sign-in attempts
-- between them, well short of any real abuse.
--
-- Explicit per-action entries (the same `value || jsonb_build_object(...)`
-- merge every other rate_limits-tuning change in this schema uses) rather
-- than raising the generic `else` default itself, which would also raise
-- the limit for every other not-yet-configured action that ever falls
-- through to it -- a much wider, unintended blast radius than the two
-- login endpoints this is actually about.
update system_settings
set value = value || jsonb_build_object(
  'app_login', jsonb_build_object('max_count', 25, 'window_seconds', 600),
  'merchant_app_login', jsonb_build_object('max_count', 25, 'window_seconds', 600)
)
where key = 'rate_limits';
