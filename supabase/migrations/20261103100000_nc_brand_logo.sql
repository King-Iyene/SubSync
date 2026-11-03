-- Additive: the agency logo web address. `detected_logo_url` comes from the install event and sign-in (white-label details);
-- `brand_logo_url` is the owner's own address from Settings and wins. Both are https only (checked in code); the server never fetches them.
alter table public.settings add column if not exists detected_logo_url text;
alter table public.settings add column if not exists brand_logo_url text;
