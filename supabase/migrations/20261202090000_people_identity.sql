-- Team (People) module, slice PD: who the people are. Additive and idempotent only. Metadata only: never message text.
-- One row per person per installation, keyed by the CRM user id (never matched by name), plus the accounts each person can reach.
-- Filled by the account sync (users list) and by the hourly sweep (a user id seen in activity that the users list does not know becomes a "new person" row).
create table if not exists public.team_members (
  installation_id uuid not null references public.installations (id) on delete cascade,
  user_id text not null,
  name text,
  email text,
  role text not null default 'unknown' check (role in ('agency_admin', 'agency_staff', 'account_admin', 'account_user', 'unknown')),
  user_type text,
  photo_url text,
  all_accounts boolean not null default false,
  deleted boolean not null default false,
  source text not null default 'users' check (source in ('users', 'activity')),
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  primary key (installation_id, user_id)
);
create index if not exists team_members_seen_idx on public.team_members (installation_id, last_seen desc);
alter table public.team_members enable row level security;
revoke all on public.team_members from anon, authenticated;

-- Which accounts a person can reach, and how we know (the CRM roles list, the account's own users list, or only activity seen there).
create table if not exists public.team_member_access (
  installation_id uuid not null references public.installations (id) on delete cascade,
  user_id text not null,
  location_id text not null,
  source text not null default 'location_list' check (source in ('roles', 'location_list', 'activity')),
  seen_at timestamptz not null default now(),
  primary key (installation_id, user_id, location_id)
);
create index if not exists team_member_access_loc_idx on public.team_member_access (installation_id, location_id, user_id);
alter table public.team_member_access enable row level security;
revoke all on public.team_member_access from anon, authenticated;
