-- Customers need to see basic merchant info (e.g. business_name on their own
-- orders, or browsing a merchant storefront) without being staff/owner/Tolo.
create policy "merchants_public_select_active" on merchants
  for select using (status = 'active');
