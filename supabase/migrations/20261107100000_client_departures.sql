-- Additive: Today's "Clients coming and going" tab. When a client leaves (uninstalls, or is removed from the company's list) its row in `locations` is deleted, so the
-- date it left was lost. This small table keeps one line per departure: which client, when it was first seen, when it left. History starts the day this runs.
-- Arrivals need no new table: they are the `created_at` of the `locations` rows (and `added_at` here for the clients that have since left).
-- If this has not been applied yet, the tab still shows arrivals and says departures start being recorded after the update. Safe to run twice.

create table if not exists public.client_departures (
  installation_id uuid not null references public.installations (id) on delete cascade,
  location_id text not null,
  name text,
  added_at timestamptz,
  removed_at timestamptz not null default now(),
  primary key (installation_id, location_id, removed_at)
);
create index if not exists client_departures_when_idx on public.client_departures (installation_id, removed_at desc);
alter table public.client_departures enable row level security;
