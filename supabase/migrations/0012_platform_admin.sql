create table audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references profiles(id),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index idx_audit_logs_entity on audit_logs(entity_type, entity_id);
create index idx_audit_logs_actor on audit_logs(actor_id);

create table system_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references profiles(id)
);

create trigger system_settings_set_updated_at
  before update on system_settings
  for each row execute function set_updated_at();

insert into system_settings (key, value) values
  ('product_publication_mode', '"approval_required"'::jsonb),
  ('default_commission_rate_percent', '10'::jsonb);
