-- Additive: Meeting notes revamp (docs/features/MEETINGS_BRIEF.md slice 4). One row per client account per day with COUNTS of what happened to the calls held that day
-- (calls held, logged within 24 hours, next step set, deal moved or a booking made within 7 days). Ids and counts only, never a title, a summary, a person or a transcript.
-- Written by the daily meeting job, idempotent on (installation, account, day), kept as our own history that cannot be rebuilt later. Safe to run twice.
create table if not exists public.mn_outcomes (
  installation_id uuid not null references public.installations (id) on delete cascade,
  location_id text not null,
  day date not null,
  meetings_held integer not null default 0,
  logged_24h integer not null default 0,
  next_step_set integer not null default 0,
  moved_or_booked_7d integer not null default 0,
  primary key (installation_id, location_id, day)
);
create index if not exists mn_outcomes_day_idx on public.mn_outcomes (installation_id, day desc);
alter table public.mn_outcomes enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on table public.mn_outcomes from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on table public.mn_outcomes from authenticated;
  end if;
end $$;
