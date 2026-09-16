-- Merchant order acknowledgement tracking (spec: "Merchant Order Notification
-- & Order Received Flow"). The existing 'accepted' status IS the "ORDER
-- RECEIVED" step and 'processing' IS "PREPARING" — no enum change, just the
-- timestamps needed to measure and enforce the acknowledgement flow.
alter table merchant_orders
  add column notification_sent_at timestamptz,
  add column notification_delivered_at timestamptz,
  add column order_received_at timestamptz,
  add column received_by uuid references profiles(id),
  add column preparation_started_at timestamptz,
  add column ready_for_pickup_at timestamptz,
  add column acknowledgement_delay interval generated always as (order_received_at - notification_sent_at) stored;

insert into system_settings (key, value) values
  ('unacknowledged_order_escalation_minutes', '15'::jsonb)
on conflict (key) do nothing;

-- Required for the merchant dashboard's live "new order" alert (Realtime
-- subscription on postgres_changes for this table).
alter publication supabase_realtime add table merchant_orders;
