-- Additive and idempotent: "Not now" on a group of likely duplicates (stage DUP).
-- A group the person set aside leaves the open list until `until`, then comes back. A person's decision "not a duplicate" or
-- "merged in the CRM" already lives in duplicate_reviews; nothing there changes. This table holds ids and a date only (no contact detail).
create table if not exists public.duplicate_snoozes (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null references public.installations (id) on delete cascade,
  location_id text not null,
  group_key text not null,
  until timestamptz not null,
  decided_by text,
  created_at timestamptz not null default now(),
  unique (installation_id, location_id, group_key)
);
create index if not exists duplicate_snoozes_installation_idx on public.duplicate_snoozes (installation_id, until);
alter table public.duplicate_snoozes enable row level security;
