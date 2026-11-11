-- Team (People) module, slice PD: the per-person rollups. Additive and idempotent only.
-- user_daily: one row per person per account per day, summed from the synced records by the hourly sweep, so the Team screens read a few thousand rows instead of every touch.
-- The sweep upserts the same days again (idempotent). Screens fall back to the identical live scan when a rollup is missing or older than two hours.
-- user_id values starting with a tilde are not people: ~automated (messages a workflow sent) and ~unknown (a message with no person recorded), kept so the totals add up.
create table if not exists public.user_daily (
  installation_id uuid not null references public.installations (id) on delete cascade,
  location_id text not null,
  user_id text not null,
  day date not null,
  touches_sms integer not null default 0,
  touches_email integer not null default 0,
  touches_call integer not null default 0,
  touches_other integer not null default 0,
  first_replies integer not null default 0,
  in_time integer not null default 0,
  median_seconds integer,
  appts_set integer not null default 0,
  appts_set_est integer not null default 0,
  set_showed integer not null default 0,
  set_noshow integer not null default 0,
  held integer not null default 0,
  no_show integer not null default 0,
  deals_won integer not null default 0,
  won_value double precision not null default 0,
  deals_lost integer not null default 0,
  lost_value double precision not null default 0,
  refreshed_at timestamptz not null default now(),
  primary key (installation_id, location_id, user_id, day)
);
create index if not exists user_daily_day_idx on public.user_daily (installation_id, day desc);
create index if not exists user_daily_user_idx on public.user_daily (installation_id, user_id, day desc);
alter table public.user_daily enable row level security;
revoke all on public.user_daily from anon, authenticated;

-- Per account: when the rollup last ran and the first day we hold ("history starts ...").
create table if not exists public.user_rollup_state (
  installation_id uuid not null references public.installations (id) on delete cascade,
  location_id text not null,
  refreshed_at timestamptz not null default now(),
  first_day date,
  people integer not null default 0,
  primary key (installation_id, location_id)
);
alter table public.user_rollup_state enable row level security;
revoke all on public.user_rollup_state from anon, authenticated;

-- Workload over time: one snapshot per person per account per day (the CRM keeps no history of who held what). The last write of the day wins.
create table if not exists public.user_workload_daily (
  installation_id uuid not null references public.installations (id) on delete cascade,
  location_id text not null,
  user_id text not null,
  day date not null,
  waiting integer not null default 0,
  waiting_old integer not null default 0,
  open_deals integer not null default 0,
  open_value double precision not null default 0,
  stale_deals integer not null default 0,
  stale_value double precision not null default 0,
  upcoming integer not null default 0,
  needs_outcome integer not null default 0,
  last_touch_at timestamptz,
  refreshed_at timestamptz not null default now(),
  primary key (installation_id, location_id, user_id, day)
);
create index if not exists user_workload_daily_user_idx on public.user_workload_daily (installation_id, user_id, day desc);
alter table public.user_workload_daily enable row level security;
revoke all on public.user_workload_daily from anon, authenticated;

create index if not exists touch_events_person_idx on public.touch_events (installation_id, user_id, at) where user_id is not null;
