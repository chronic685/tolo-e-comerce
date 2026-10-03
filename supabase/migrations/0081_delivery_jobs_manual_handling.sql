-- A delivery job the marketplace refuses to send on its own (the customer has
-- no Tolo-verified phone, no pickup location, ...) is flagged here so an admin
-- can see it on the Orders page and arrange the delivery by hand. Retryable
-- failures (the Tolo Delivery app being down) are not flagged: they keep
-- handoff_error only.
alter table delivery_jobs add column needs_manual_handling boolean not null default false;

-- Orders-page staff handle these, so let them read jobs too (delivery_ops and
-- admins already could; see 0080).
alter policy delivery_jobs_select on delivery_jobs
  using (
    order_owner_for_merchant_order(merchant_order_id) = auth.uid()
    or is_merchant_member(merchant_id_for_merchant_order(merchant_order_id))
    or has_admin_page(array['delivery_ops', 'orders'])
  );
