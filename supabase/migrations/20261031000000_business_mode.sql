-- Additive: lets a single business (one client account) install the app for itself, and lets an
-- agency choose which of its clients may open the app inside their own account.
-- Nothing here changes or removes existing data.

-- 'agency' (the default, every existing row) or 'business' (installed by one client account).
-- A business install is keyed by company_id = 'loc:<locationId>' so the existing unique key holds.
alter table public.installations add column if not exists mode text not null default 'agency';
alter table public.installations add column if not exists location_id text;
alter table public.installations add column if not exists agency_company_id text;
-- The plan id the marketplace reports for the install, kept so plans can be mapped to tiers.
alter table public.installations add column if not exists plan_id text;

create index if not exists installations_location_idx on public.installations (location_id) where location_id is not null;

-- The agency can let a client open the app inside their own account (a read-only view of that
-- one account). Off by default.
alter table public.locations add column if not exists client_view boolean not null default false;
