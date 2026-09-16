-- Richer merchant registration fields (spec section 2).
alter table merchants
  add column business_subcategory text,
  add column city text,
  add column sub_city text,
  add column woreda text,
  add column landmark text,
  add column latitude numeric(9,6),
  add column longitude numeric(9,6),
  add column owner_full_name text,
  add column owner_phone text,
  add column owner_email text;

-- Document verification metadata (spec section 4).
alter table merchant_documents
  add column file_name text,
  add column expiration_date date,
  add column rejection_reason text,
  add column verified_by uuid references profiles(id),
  add column verification_date timestamptz,
  alter column status set default 'uploaded';

alter table merchant_documents
  add constraint merchant_documents_status_check
  check (status in ('uploaded', 'under_review', 'verified', 'rejected'));

-- Private bucket for business documents (trade license, VAT, TIN, ID) — must
-- never be publicly readable (spec section 26). Public bucket for product
-- photos, which are meant to be publicly visible once a product is published.
insert into storage.buckets (id, name, public)
values ('merchant-documents', 'merchant-documents', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do nothing;

-- Objects are stored under "<merchant_id>/<filename>"; policies key off that
-- first path segment via storage.foldername(name).
create policy "merchant_documents_storage_select" on storage.objects
  for select using (
    bucket_id = 'merchant-documents'
    and (is_merchant_member((storage.foldername(name))[1]::uuid) or is_tolo_staff())
  );

create policy "merchant_documents_storage_insert" on storage.objects
  for insert with check (
    bucket_id = 'merchant-documents'
    and is_merchant_member((storage.foldername(name))[1]::uuid)
  );

create policy "merchant_documents_storage_delete" on storage.objects
  for delete using (
    bucket_id = 'merchant-documents'
    and (is_merchant_member((storage.foldername(name))[1]::uuid) or is_tolo_staff())
  );

create policy "product_images_storage_select_public" on storage.objects
  for select using (bucket_id = 'product-images');

create policy "product_images_storage_insert" on storage.objects
  for insert with check (
    bucket_id = 'product-images'
    and is_merchant_member((storage.foldername(name))[1]::uuid)
  );

create policy "product_images_storage_delete" on storage.objects
  for delete using (
    bucket_id = 'product-images'
    and (is_merchant_member((storage.foldername(name))[1]::uuid) or is_tolo_staff())
  );
