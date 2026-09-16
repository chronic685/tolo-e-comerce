-- Promote the demo admin account to tolo_admin. Direct UPDATE is normally
-- blocked by profiles_prevent_role_escalation (self-escalation guard); since
-- this runs as the migration owner rather than through a user's own RLS
-- session, we briefly disable that trigger rather than route around it.
alter table profiles disable trigger profiles_prevent_role_escalation;

update profiles set role = 'tolo_admin'
where id = 'c3b6fa87-1a4a-4552-9abf-aa416c7fab5e';

alter table profiles enable trigger profiles_prevent_role_escalation;
