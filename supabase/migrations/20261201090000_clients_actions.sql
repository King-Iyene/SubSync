-- Clients module, slice CB (actions and reports). Additive and idempotent. Not applied automatically.
-- client_alert_mutes: SubSync's own "I know, remind me later" mark on one client account's attention list. No CRM write. Reversible (released_at). Ids, a kind and dates only.
-- client_actions: one row per change made on the Clients screen (mute, unmute, reply target), with what it was before so it can be put back. Never a name, a note or a message.
create table if not exists public.client_alert_mutes (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null references public.installations (id) on delete cascade,
  location_id text not null,
  kind text not null check (kind in ('all', 'replies', 'noshows', 'stale', 'renewal')),
  until timestamptz not null,
  created_by text,
  created_at timestamptz not null default now(),
  released_at timestamptz
);
create index if not exists client_alert_mutes_open_idx on public.client_alert_mutes (installation_id, location_id, until) where released_at is null;
alter table public.client_alert_mutes enable row level security;
revoke all on public.client_alert_mutes from anon, authenticated;

create table if not exists public.client_actions (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null references public.installations (id) on delete cascade,
  location_id text not null,
  action text not null check (action in ('mute', 'unmute', 'target')),
  before_value jsonb not null default '{}'::jsonb,
  after_value jsonb not null default '{}'::jsonb,
  actor text,
  created_at timestamptz not null default now()
);
create index if not exists client_actions_loc_idx on public.client_actions (installation_id, location_id, created_at desc);
alter table public.client_actions enable row level security;
revoke all on public.client_actions from anon, authenticated;

-- Who at the agency looks after each client (a typed name; SubSync-only, never sent to the CRM).
create table if not exists public.client_owners (
  installation_id uuid not null references public.installations (id) on delete cascade,
  location_id text not null,
  owner_name text not null check (char_length(owner_name) between 1 and 60),
  set_by text,
  updated_at timestamptz not null default now(),
  primary key (installation_id, location_id)
);
alter table public.client_owners enable row level security;
revoke all on public.client_owners from anon, authenticated;
