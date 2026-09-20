-- Phase 5d, item 9: the new order-confirmation screen shows an estimated
-- delivery time when one can be derived. resolve_delivery_fee/haversine_km
-- already do the real nearest-active-zone lookup but are locked down to
-- service-role only (migration 0035) since resolve_delivery_fee also decides
-- the actual charged fee, which must stay server-decided, not client-visible
-- ahead of time. This mirrors just the zone lookup and returns only
-- estimated_delivery_minutes -- no fee, no zone identity, nothing a customer
-- couldn't already infer from "delivery is available in my area" -- so it's
-- safe to grant directly to authenticated.
create or replace function get_estimated_delivery_minutes(p_latitude numeric, p_longitude numeric)
returns int
language plpgsql stable security definer set search_path = public
as $$
declare
  v_minutes int;
begin
  if p_latitude is null or p_longitude is null then
    return null;
  end if;

  select z.estimated_delivery_minutes into v_minutes
  from delivery_zones z
  where z.is_active
    and haversine_km(z.center_latitude, z.center_longitude, p_latitude, p_longitude) <= z.radius_km
  order by haversine_km(z.center_latitude, z.center_longitude, p_latitude, p_longitude) asc
  limit 1;

  return v_minutes;
end;
$$;

grant execute on function get_estimated_delivery_minutes(numeric, numeric) to authenticated;
