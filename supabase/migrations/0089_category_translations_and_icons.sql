-- Categories are a small admin-managed list, so their Amharic name is data on the
-- row (name_am), not a UI string: the i18n files translate screens, and an admin
-- adding a category can't edit those. name stays the canonical English name used
-- for slugs, search and admin screens; name_am is optional and the apps fall
-- back to name when it is empty.
--
-- icon / color give each category its tile and chip look. icon is the name of an
-- icon from the set the apps ship (@tolo/ui's CategoryIcon; an unknown name
-- renders a generic tag), color one of a fixed palette so dark mode and the brand
-- palette are handled in the apps' styles rather than by free-form values.
alter table categories
  add column name_am text,
  add column icon text not null default 'tag',
  add column color text not null default 'navy';

alter table categories
  add constraint categories_color_check
  check (color in ('navy', 'rose', 'amber', 'violet', 'emerald', 'sky', 'teal', 'orange'));

-- Defaults for the five seeded categories (matched by slug, so a renamed or
-- missing one is simply skipped). The Amharic names are first drafts for a
-- native speaker to confirm in the admin Categories page.
update categories as c
set name_am = v.name_am, icon = v.icon, color = v.color
from (values
  ('fashion',       'ፋሽን',          'shirt',           'rose'),
  ('home-living',   'ቤትና አኗኗር',     'sofa',            'amber'),
  ('beauty-health', 'ውበትና ጤና',      'sparkles',        'violet'),
  ('groceries',     'የምግብ ሸቀጦች',    'shopping-basket', 'emerald'),
  ('electronics',   'ኤሌክትሮኒክስ',    'smartphone',      'sky')
) as v(slug, name_am, icon, color)
where c.slug = v.slug;
