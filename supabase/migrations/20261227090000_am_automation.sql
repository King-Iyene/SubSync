-- Additive: Automation pass (automatic short meeting notes, notices, Slack routing choices). Safe to run twice. Not applied by hand: it ships through the pull request check and the production approval.
alter table public.meeting_note_settings add column if not exists auto_add_notes boolean not null default false;
alter table public.meeting_note_settings add column if not exists auto_add_accepted_at timestamptz;

-- A short notice for one person (private to them): a meeting was added to a contact, or it waits for them to pick the contact. Ids and the meeting title only.
create table if not exists public.am_notices (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null references public.installations (id) on delete cascade,
  owner_ghl_user_id text not null,
  meeting_id uuid not null references public.meetings (id) on delete cascade,
  kind text not null check (kind in ('added', 'needs_matching')),
  text text not null,
  location_id text,
  contact_id text,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique (meeting_id, kind)
);
create index if not exists am_notices_owner_idx on public.am_notices (installation_id, owner_ghl_user_id, created_at desc);

-- Each note added by itself, for the "Added today" list and Undo. One row per meeting and contact, so the same meeting never adds two notes. Ids only.
create table if not exists public.am_auto_adds (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null references public.installations (id) on delete cascade,
  owner_ghl_user_id text not null,
  meeting_id uuid not null references public.meetings (id) on delete cascade,
  location_id text not null,
  contact_id text not null,
  ghl_note_id text,
  status text not null default 'added' check (status in ('added', 'dry_run', 'undone')),
  created_at timestamptz not null default now(),
  undone_at timestamptz,
  unique (meeting_id, contact_id)
);
create index if not exists am_auto_adds_owner_idx on public.am_auto_adds (installation_id, owner_ghl_user_id, created_at desc);

-- Slack choices for the company: pause everything, and which client accounts are muted.
create table if not exists public.am_slack_prefs (
  installation_id uuid primary key references public.installations (id) on delete cascade,
  pause_all boolean not null default false,
  muted_locations text[] not null default '{}',
  updated_at timestamptz not null default now()
);

alter table public.am_notices enable row level security;
alter table public.am_auto_adds enable row level security;
alter table public.am_slack_prefs enable row level security;

do $$
declare t text;
begin
  foreach t in array array['am_notices', 'am_auto_adds', 'am_slack_prefs'] loop
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on table public.%I from anon', t);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('revoke all on table public.%I from authenticated', t);
    end if;
  end loop;
end $$;
