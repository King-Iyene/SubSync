-- Appointments, Leadership tab (executive view). Additive and idempotent only. Counts only: no names, no message text.
-- appointment_exec_daily: one row per account per appointment day per calendar, owner, booker and source, summed from the synced appointments, so the leadership screens
-- read a few thousand rows instead of every appointment. A refresh recomputes the same days again (idempotent). Screens recompute live when a filter the rollup does not hold is set.
-- Empty-string dimensions mean "not recorded" (a primary key cannot hold null).
create table if not exists public.appointment_exec_daily (
  installation_id uuid not null references public.installations (id) on delete cascade,
  location_id text not null,
  day date not null,
  calendar_id text not null default '',
  owner_id text not null default '',
  booker_id text not null default '',
  source text not null default '',
  booked integer not null default 0,
  confirmed integer not null default 0,
  showed integer not null default 0,
  noshow integer not null default 0,
  cancelled integer not null default 0,
  unmarked integer not null default 0,
  rescheduled integer not null default 0,
  won integer not null default 0,
  won_value double precision not null default 0,
  lost integer not null default 0,
  ltb_sum_min double precision not null default 0,
  ltb_n integer not null default 0,
  b2m_sum_hours double precision not null default 0,
  b2m_n integer not null default 0,
  refreshed_at timestamptz not null default now(),
  primary key (installation_id, location_id, day, calendar_id, owner_id, booker_id, source)
);
create index if not exists appointment_exec_daily_day_idx on public.appointment_exec_daily (installation_id, day desc);
create index if not exists appointment_exec_daily_cal_idx on public.appointment_exec_daily (installation_id, calendar_id, day desc);
alter table public.appointment_exec_daily enable row level security;
revoke all on public.appointment_exec_daily from anon, authenticated;

-- Per account: when the rollup last ran and the first day we hold ("history starts ...").
create table if not exists public.appointment_exec_state (
  installation_id uuid not null references public.installations (id) on delete cascade,
  location_id text not null,
  refreshed_at timestamptz not null default now(),
  first_day date,
  primary key (installation_id, location_id)
);
alter table public.appointment_exec_state enable row level security;
revoke all on public.appointment_exec_state from anon, authenticated;

-- The monthly booking target a leader sets for one account (location_id '') or for everything they see. Only SubSync uses it; nothing is written to the CRM.
-- previous_target keeps the one value before, so a change can be undone.
create table if not exists public.appointment_exec_targets (
  installation_id uuid not null references public.installations (id) on delete cascade,
  location_id text not null default '',
  monthly_target integer,
  previous_target integer,
  set_by text,
  updated_at timestamptz not null default now(),
  primary key (installation_id, location_id)
);
alter table public.appointment_exec_targets enable row level security;
revoke all on public.appointment_exec_targets from anon, authenticated;
