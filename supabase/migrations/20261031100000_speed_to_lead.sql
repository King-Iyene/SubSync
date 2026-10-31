-- Additive: speed to lead. One row per lead (a new contact that has a conversation) with when it started
-- and when a person first replied. Plus the two settings it needs and a per-account permission state.
-- Nothing here changes or removes existing data.

create table if not exists public.lead_touches (
  id bigint generated always as identity primary key,
  installation_id uuid not null references public.installations (id) on delete cascade,
  location_id text not null,
  contact_id text not null,
  conversation_id text not null,
  lead_at timestamptz not null,
  touch_at timestamptz,
  touch_user_id text,
  checked_at timestamptz not null default now(),
  unique (installation_id, location_id, conversation_id)
);
create index if not exists lead_touches_install_idx on public.lead_touches (installation_id, location_id, lead_at desc);
alter table public.lead_touches enable row level security;

-- The reply target for a new lead, in minutes (short on purpose: a lead cools in minutes, not hours),
-- and whether automatic messages may count as the first touch (off by default).
alter table public.settings add column if not exists speed_target_minutes integer not null default 15;
alter table public.settings add column if not exists count_automated_touches boolean not null default false;

alter table public.locations add column if not exists speed_access text;
alter table public.locations add column if not exists speed_synced_at timestamptz;

alter table public.sync_jobs drop constraint if exists sync_jobs_type_check;
alter table public.sync_jobs add constraint sync_jobs_type_check
  check (type in ('locations', 'structure', 'contacts', 'opportunities', 'conversations', 'appointments', 'speed', 'metrics'));
