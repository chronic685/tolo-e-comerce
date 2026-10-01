-- Private bucket for merchant-application license photos (migration 0073).
-- Type and size are enforced by Storage itself on upload (same mechanism
-- migration 0030 uses for merchant-documents/product-images), not only by
-- the form's client-side check.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'merchant-application-licenses',
  'merchant-application-licenses',
  false,
  5242880, -- 5 MB
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- Objects live under "<applicant auth uid>/<file>". An application doesn't
-- exist yet when its photo is uploaded (the form uploads, then submits), so
-- "the applicant's own application" is bound by that folder:
-- submit_merchant_application() only accepts a path inside the caller's
-- own folder. Uploading also requires a verified phone -- the same gate as
-- submitting -- so an account that can't apply can't fill the bucket either.
create policy merchant_application_licenses_insert on storage.objects
  for insert with check (
    bucket_id = 'merchant-application-licenses'
    and (storage.foldername(name))[1] = auth.uid()::text
    and exists (select 1 from tolo_phone_links l where l.user_id = auth.uid())
  );

-- Admin tier only -- not even the applicant reads it back (the form shows
-- a local preview before upload instead). Same tier that reviews the
-- application (migration 0073).
create policy merchant_application_licenses_select on storage.objects
  for select using (
    bucket_id = 'merchant-application-licenses'
    and is_tolo_admin()
  );

-- No update/delete policy: an uploaded license is part of the review
-- record, and an applicant who picks a different photo just uploads a new
-- object under a new name.
