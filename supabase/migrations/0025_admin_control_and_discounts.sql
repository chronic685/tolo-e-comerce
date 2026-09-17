-- Admin Control & Analytics spec, sections 8-11, 25, 35-36:
--   - granular staff roles beyond the original ops/finance/admin trio
--   - a real discount/promotion engine (schema + checkout wiring), replacing
--     the per-variant discount_price as the only price lever
--   - a generic config-change log so sensitive setting changes record
--     before/after/who/when, reusing audit_logs rather than a parallel table

-- 1. Granular roles -----------------------------------------------------

alter type user_role_platform add value 'tolo_marketing';
alter type user_role_platform add value 'tolo_support';
alter type user_role_platform add value 'tolo_merchant_verification';
