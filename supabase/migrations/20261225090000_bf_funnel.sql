-- Booking funnel (stage BF). Additive and idempotent. Not applied by hand: it ships through the pull request (fresh-database check), then the production apply is approved by King.
--
-- bf_funnel_daily  one row per account, day a lead came in, hour, source, form, lead owner, setter, closer and calendar: how many leads reached each step of the booking funnel
--                  (answered, booked, showed, deal opened, won), the money won, the time sums between steps and how many booked, showed or won within 7, 14 and 30 days.
--                  Counts and sums only, never who. It is a copy of what the contacts, touches, appointments and deals already say, so it can be rebuilt; the weekly cohorts read from it.
-- bf_funnel_state  when each account's rows were last rebuilt and the first day they hold ("history starts ...").
do $$
begin
  create table if not exists public.bf_funnel_daily (
    installation_id uuid not null references public.installations (id) on delete cascade,
    location_id text not null,
    day date not null,
    hour smallint not null default 0,
    src text not null default '',
    form_id text not null default '',
    owner_id text not null default '',
    setter_id text not null default '',
    closer_id text not null default '',
    calendar_id text not null default '',
    leads integer not null default 0,
    reach_answered integer not null default 0,
    reach_booked integer not null default 0,
    reach_showed integer not null default 0,
    reach_deal integer not null default 0,
    reach_won integer not null default 0,
    won_value numeric not null default 0,
    lost integer not null default 0,
    t_touch_secs double precision not null default 0,
    t_touch_n integer not null default 0,
    t_book_secs double precision not null default 0,
    t_book_n integer not null default 0,
    t_show_secs double precision not null default 0,
    t_show_n integer not null default 0,
    t_win_secs double precision not null default 0,
    t_win_n integer not null default 0,
    mature7 integer not null default 0,
    mature14 integer not null default 0,
    mature30 integer not null default 0,
    booked7 integer not null default 0,
    booked14 integer not null default 0,
    booked30 integer not null default 0,
    showed7 integer not null default 0,
    showed14 integer not null default 0,
    showed30 integer not null default 0,
    won7 integer not null default 0,
    won14 integer not null default 0,
    won30 integer not null default 0,
    primary key (installation_id, location_id, day, hour, src, form_id, owner_id, setter_id, closer_id, calendar_id)
  );
  create index if not exists bf_funnel_daily_day_idx on public.bf_funnel_daily (installation_id, day desc);
  alter table public.bf_funnel_daily enable row level security;
  revoke all on public.bf_funnel_daily from anon, authenticated;

  create table if not exists public.bf_funnel_state (
    installation_id uuid not null references public.installations (id) on delete cascade,
    location_id text not null,
    refreshed_at timestamptz not null default now(),
    first_day date,
    primary key (installation_id, location_id)
  );
  alter table public.bf_funnel_state enable row level security;
  revoke all on public.bf_funnel_state from anon, authenticated;
end $$;
