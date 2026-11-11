-- Appointments: the account's FULL calendar list (so a calendar with no bookings still shows up, which is how a dead calendar is spotted).
-- Additive and idempotent only. Metadata only: calendar names, groups and which team members are on a calendar. Never contact data or message text.
create table if not exists public.cached_calendars (
  installation_id uuid not null references public.installations (id) on delete cascade,
  location_id text not null,
  calendar_id text not null,
  name text,
  group_id text,
  is_active boolean not null default true,
  calendar_type text,          -- as the platform names it (for example round robin, event, class); null when it did not say
  round_robin boolean not null default false,
  synced_at timestamptz not null default now(),
  primary key (installation_id, location_id, calendar_id)
);
create index if not exists cached_calendars_group_idx on public.cached_calendars (installation_id, location_id, group_id);
alter table public.cached_calendars enable row level security;
revoke all on public.cached_calendars from anon, authenticated;

create table if not exists public.calendar_groups (
  installation_id uuid not null references public.installations (id) on delete cascade,
  location_id text not null,
  group_id text not null,
  name text,
  is_active boolean not null default true,
  synced_at timestamptz not null default now(),
  primary key (installation_id, location_id, group_id)
);
alter table public.calendar_groups enable row level security;
revoke all on public.calendar_groups from anon, authenticated;

create table if not exists public.calendar_members (
  installation_id uuid not null references public.installations (id) on delete cascade,
  location_id text not null,
  calendar_id text not null,
  user_id text not null,
  synced_at timestamptz not null default now(),
  primary key (installation_id, location_id, calendar_id, user_id)
);
create index if not exists calendar_members_user_idx on public.calendar_members (installation_id, location_id, user_id);
alter table public.calendar_members enable row level security;
revoke all on public.calendar_members from anon, authenticated;

-- Whether the calendar list and the groups list could be read: ok, needs_permission, or error. Never blank on the screen.
do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'locations' and column_name = 'calendars_access') then
    alter table public.locations add column calendars_access text;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'locations' and column_name = 'calendars_skipped') then
    alter table public.locations add column calendars_skipped integer not null default 0;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'locations' and column_name = 'calendar_groups_access') then
    alter table public.locations add column calendar_groups_access text;
  end if;
end $$;
