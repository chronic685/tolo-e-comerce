-- Group 4, item 14: "report a problem" on an order already existed
-- (support_tickets, migration 0011/0044 -- OrderDetail.tsx's
-- DisputeWidget) but had no photo upload, and support_tickets_select only
-- ever let the reporting customer or Tolo staff see a ticket -- not the
-- merchant the order/complaint is actually about, so it wasn't "visible
-- to merchant and admin" at all on the merchant side.

alter table support_tickets add column photo_url text;

-- Private bucket, same treatment as merchant-documents (migration 0022) --
-- a customer's complaint photo must never be publicly readable. Objects
-- are stored under "<merchant_order_id>/<filename>" (not <user_id>/...,
-- unlike merchant-documents) so a storage policy can check "does the
-- caller own or work at the order this specific photo is about" directly
-- from the path, without a second table lookup to disambiguate which of
-- a customer's several tickets a photo belongs to.
insert into storage.buckets (id, name, public)
values ('support-ticket-photos', 'support-ticket-photos', false)
on conflict (id) do nothing;

create policy "support_ticket_photos_storage_select" on storage.objects
  for select using (
    bucket_id = 'support-ticket-photos'
    and (
      order_owner_for_merchant_order((storage.foldername(name))[1]::uuid) = auth.uid()
      or is_merchant_member(merchant_id_for_merchant_order((storage.foldername(name))[1]::uuid))
      or has_admin_page(array['support'])
    )
  );

-- Only the order's own customer can upload a photo for it -- matches
-- support_tickets_insert_own's own ownership check (migration 0044) so
-- the photo and the ticket row it's attached to are gated the same way.
create policy "support_ticket_photos_storage_insert" on storage.objects
  for insert with check (
    bucket_id = 'support-ticket-photos'
    and order_owner_for_merchant_order((storage.foldername(name))[1]::uuid) = auth.uid()
  );

-- support_tickets_select: add merchant visibility for a ticket about one
-- of their own merchant_orders, alongside the existing "reporting
-- customer, or Tolo staff" access.
alter policy support_tickets_select on support_tickets
  using (
    user_id = auth.uid()
    or has_admin_page(array['support', 'dashboard'])
    or (merchant_order_id is not null and is_merchant_member(merchant_id_for_merchant_order(merchant_order_id)))
  );
