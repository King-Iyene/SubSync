-- Stage E0 (connections framework, per user). Additive and idempotent: five NEW tables, nothing existing is changed.
-- Row level security is on for every table and NO policy is created, so the public (anon) and signed-in (authenticated) database roles read
-- and write nothing. Only server code, which connects with the database owner role, can use these tables. The same roles also lose their
-- table privileges, so a future policy added by mistake would still not open them.
--
-- A personal tool (Fathom, and later Zoom and Google Meet) belongs to the PERSON who connected it: one row per (CRM user id, provider).
-- Tokens are encrypted by the app before they are saved (columns ending _enc) and no query that feeds a screen selects them.

create table if not exists public.user_connections (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null references public.installations (id) on delete cascade,
  -- The sign-in key of the company or business the person belongs to (the same key sessions carry).
  company_key text not null,
  ghl_user_id text not null,
  person_name text,
  -- The client account the person had open when they connected (empty for company staff, who work across accounts).
  home_location_id text,
  -- The role sign-in worked out for the person when they connected (owner, administrator, staff...). A webhook has no signed-in user, so it needs this to know
  -- which client accounts the person may reach. It is rechecked whenever they sign in again.
  person_role text,
  provider text not null check (provider in ('fathom', 'zoom', 'google_meet')),
  provider_account_email text,
  scopes_granted text,
  access_token_enc text,
  refresh_token_enc text,
  token_expires_at timestamptz,
  webhook_id text,
  webhook_secret_enc text,
  public_key text unique,
  status text not null default 'pending' check (status in ('pending', 'connected', 'needs_reconnect', 'revoked', 'error')),
  pending_since timestamptz,
  last_ok_at timestamptz,
  last_error_code text,
  last_event_at timestamptz,
  saved_count integer not null default 0,
  skipped_count integer not null default 0,
  revoked_by text,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists user_connections_person_provider_idx on public.user_connections (ghl_user_id, provider);
create index if not exists user_connections_installation_idx on public.user_connections (installation_id);

-- What each person chose to save and where (inside what the admin allows).
create table if not exists public.meeting_note_settings (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null references public.installations (id) on delete cascade,
  ghl_user_id text not null,
  content_matrix jsonb not null default '{}',
  preset text not null default 'recommended' check (preset in ('recommended', 'full_record', 'summary_only', 'custom')),
  unmatched_mode text not null default 'inbox' check (unmatched_mode in ('inbox', 'discard')),
  source_priority jsonb not null default '["fathom","zoom","google_meet"]',
  preview_confirmed_at timestamptz,
  master_switch boolean not null default true,
  updated_at timestamptz not null default now()
);
create unique index if not exists meeting_note_settings_person_idx on public.meeting_note_settings (ghl_user_id);
create index if not exists meeting_note_settings_installation_idx on public.meeting_note_settings (installation_id);

-- Limits, not choices: the company default and each client account's own rule. The most restrictive of company, account and person wins.
create table if not exists public.meeting_policies (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null references public.installations (id) on delete cascade,
  scope text not null check (scope in ('agency', 'account')),
  location_id text,
  flags jsonb not null default '{}',
  set_by text,
  set_at timestamptz not null default now(),
  check ((scope = 'agency' and location_id is null) or (scope = 'account' and location_id is not null))
);
create unique index if not exists meeting_policies_scope_idx on public.meeting_policies (installation_id, scope, coalesce(location_id, ''));

-- A meeting that arrived through one person's tool. Private to that person. One row per (person, provider, provider meeting id).
create table if not exists public.meetings (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null references public.installations (id) on delete cascade,
  owner_ghl_user_id text not null,
  connection_id uuid references public.user_connections (id) on delete set null,
  provider text not null check (provider in ('fathom', 'zoom', 'google_meet')),
  provider_meeting_id text not null,
  started_at timestamptz,
  title text,
  attendee_emails jsonb not null default '[]',
  summary text,
  action_items jsonb not null default '[]',
  recording_url text,
  transcript_ref text,
  status text not null default 'needs_contact' check (status in ('saved', 'needs_contact', 'duplicate', 'skipped', 'failed', 'dry_run')),
  reason text,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists meetings_one_per_person_idx on public.meetings (owner_ghl_user_id, provider, provider_meeting_id);
create index if not exists meetings_installation_idx on public.meetings (installation_id, owner_ghl_user_id);
create index if not exists meetings_expiry_idx on public.meetings (expires_at) where expires_at is not null;

-- Everything SubSync itself wrote into the CRM, with the id the CRM gave it. Used to keep our own writes out of our own numbers
-- (a note or an internal comment must never count as a reply, as activity or as engagement) and to drop the echo of our own write.
create table if not exists public.crm_writes (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null references public.installations (id) on delete cascade,
  meeting_id uuid references public.meetings (id) on delete set null,
  location_id text not null,
  contact_id text not null,
  kind text not null check (kind in ('note', 'comment', 'field')),
  ghl_id text,
  part_no integer not null default 1,
  authored_by text,
  created_at timestamptz not null default now(),
  undone_at timestamptz
);
create unique index if not exists crm_writes_one_per_part_idx on public.crm_writes (meeting_id, contact_id, kind, part_no);
create index if not exists crm_writes_echo_idx on public.crm_writes (installation_id, ghl_id) where ghl_id is not null;
create index if not exists crm_writes_contact_idx on public.crm_writes (installation_id, location_id, contact_id, created_at);

alter table public.user_connections enable row level security;
alter table public.meeting_note_settings enable row level security;
alter table public.meeting_policies enable row level security;
alter table public.meetings enable row level security;
alter table public.crm_writes enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on table public.user_connections, public.meeting_note_settings, public.meeting_policies, public.meetings, public.crm_writes from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on table public.user_connections, public.meeting_note_settings, public.meeting_policies, public.meetings, public.crm_writes from authenticated;
  end if;
end $$;
