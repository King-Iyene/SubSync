-- Clients 3: one row per client account per day (new leads, bookings, outcomes, deals, staff messages), summed from the synced records by the hourly sweep,
-- so the Clients screens read a few thousand rows instead of every lead. Idempotent: the sweep upserts the same days again. The screens fall back to the
-- live scan when a row set is missing or older than two hours. Additive only.
create table if not exists public.client_daily (
  installation_id uuid not null references public.installations (id) on delete cascade,
  location_id text not null,
  day date not null,
  new_leads integer not null default 0,
  booked integer not null default 0,
  showed integer not null default 0,
  noshow integer not null default 0,
  deals_started integer not null default 0,
  won integer not null default 0,
  won_value double precision not null default 0,
  lost integer not null default 0,
  lost_value double precision not null default 0,
  staff_messages integer not null default 0,
  refreshed_at timestamptz not null default now(),
  primary key (installation_id, location_id, day)
);
create index if not exists client_daily_day_idx on public.client_daily (installation_id, day desc);
alter table public.client_daily enable row level security;
revoke all on public.client_daily from anon, authenticated;

-- Per account: when the rollup last ran, the first day we hold, and contact totals for the data-quality shares.
create table if not exists public.client_rollup_state (
  installation_id uuid not null references public.installations (id) on delete cascade,
  location_id text not null,
  refreshed_at timestamptz not null default now(),
  first_day date,
  contacts integer not null default 0,
  no_owner integer not null default 0,
  no_phone integer not null default 0,
  primary key (installation_id, location_id)
);
alter table public.client_rollup_state enable row level security;
revoke all on public.client_rollup_state from anon, authenticated;

create index if not exists touch_events_user_time_idx on public.touch_events (installation_id, location_id, user_id, at);
