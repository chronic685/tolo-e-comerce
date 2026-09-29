-- Group 4, item 18: "Admin-managed homepage banners." Nothing like this
-- existed -- Marketplace.tsx (the customer app's homepage) is a plain
-- filter bar + category pills + product grid, no hero/banner section at
-- all. A dedicated table rather than system_settings (a scalar key/value
-- store, migration 0012 -- no precedent there for a list of records) --
-- closest existing shape is `categories` (migration 0003/0014): image_url
-- + is_active + sort_order, public-read RLS with admin-only write via
-- has_admin_page, same pattern followed here.

create table homepage_banners (
  id uuid primary key default gen_random_uuid(),
  image_url text not null,
  link_url text,
  title text,
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger homepage_banners_set_updated_at
  before update on homepage_banners
  for each row execute function set_updated_at();

alter table homepage_banners enable row level security;

create policy "homepage_banners_public_select" on homepage_banners
  for select using (is_active or has_admin_page(array['banners']));

create policy "homepage_banners_manage" on homepage_banners
  for all using (has_admin_page(array['banners'])) with check (has_admin_page(array['banners']));

-- Public bucket, same treatment as product-images (migration 0022) --
-- banner images are shown to every customer, logged in or not, on the
-- homepage. No per-owner folder scoping needed (nothing here is
-- merchant-owned), so write access is gated on the page permission alone
-- rather than a storage.foldername() ownership check.
insert into storage.buckets (id, name, public)
values ('homepage-banners', 'homepage-banners', true)
on conflict (id) do nothing;

create policy "homepage_banners_storage_select_public" on storage.objects
  for select using (bucket_id = 'homepage-banners');

create policy "homepage_banners_storage_insert" on storage.objects
  for insert with check (bucket_id = 'homepage-banners' and has_admin_page(array['banners']));

create policy "homepage_banners_storage_update" on storage.objects
  for update using (bucket_id = 'homepage-banners' and has_admin_page(array['banners']));

create policy "homepage_banners_storage_delete" on storage.objects
  for delete using (bucket_id = 'homepage-banners' and has_admin_page(array['banners']));
