-- A suspended account could still update its own profiles row (name,
-- phone, ...) through the "own row" half of this policy, since only the
-- staff/admin half checked account_status. Suspension is meant to end
-- access outright, so the own-row path now requires an active account too.
-- Admins are unaffected (is_tolo_admin() already requires them to be
-- active). With no separate WITH CHECK, Postgres applies this expression to
-- the updated row as well.
alter policy profiles_update_own on profiles
  using (((id = auth.uid()) and account_status = 'active') or is_tolo_admin());
