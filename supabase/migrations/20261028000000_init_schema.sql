-- SubSync initial schema.
-- All access is server-side with the service role. RLS is enabled on every
-- table and there are deliberately NO policies, so anon/authenticated get nothing.
-- GHL tokens are stored encrypted (app-level AES-GCM); never log them.

create extension if not exists pg_trgm with schema extensions;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- One row per agency that installed the app (GHL company).
create table public.installations (
  id uuid primary key default gen_random_uuid(),
  company_id text not null unique,
  company_name text,
  access_token_enc text,
  refresh_token_enc text,
  token_expires_at timestamptz,
  plan text not null default 'free',
  location_limit integer not null default 5,
  installed_at timestamptz not null default now(),
  uninstalled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Client accounts (GHL locations) under an installation.
create table public.locations (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null references public.installations (id) on delete cascade,
  location_id text not null,
  name text,
  email text,
  phone text,
  timezone text,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (installation_id, location_id)
);

create table public.cached_contacts (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null references public.installations (id) on delete cascade,
  location_id text not null,
  contact_id text not null,
  first_name text,
  last_name text,
  email text,
  phone text,
  tags text[] not null default '{}',
  date_added timestamptz,
  last_activity_at timestamptz,
  synced_at timestamptz not null default now(),
  -- search helpers
  full_name text generated always as (
    btrim(coalesce(first_name, '') || ' ' || coalesce(last_name, ''))
  ) stored,
  phone_digits text generated always as (
    regexp_replace(coalesce(phone, ''), '\D', '', 'g')
  ) stored,
  unique (installation_id, location_id, contact_id)
);

create table public.cached_opportunities (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null references public.installations (id) on delete cascade,
  location_id text not null,
  opportunity_id text not null,
  pipeline_id text,
  pipeline_name text,
  stage_id text,
  stage_name text,
  contact_id text,
  contact_name text,
  name text,
  monetary_value numeric,
  status text,
  last_stage_change_at timestamptz,
  last_status_change_at timestamptz,
  synced_at timestamptz not null default now(),
  unique (installation_id, location_id, opportunity_id)
);

-- Resumable sync work: one row per (location, type) with a cursor.
create table public.sync_jobs (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null references public.installations (id) on delete cascade,
  location_id text,
  type text not null check (type in ('locations', 'contacts', 'opportunities')),
  cursor jsonb,
  status text not null default 'pending'
    check (status in ('pending', 'running', 'done', 'failed')),
  error text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.settings (
  installation_id uuid primary key references public.installations (id) on delete cascade,
  stale_deal_days integer[] not null default '{30,60,90}',
  active_contact_days integer not null default 90,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Indexes
create index locations_installation_idx on public.locations (installation_id);

create index cached_contacts_loc_idx
  on public.cached_contacts (installation_id, location_id);
create index cached_contacts_name_trgm_idx
  on public.cached_contacts using gin (full_name extensions.gin_trgm_ops);
create index cached_contacts_email_trgm_idx
  on public.cached_contacts using gin (lower(email) extensions.gin_trgm_ops);
create index cached_contacts_phone_trgm_idx
  on public.cached_contacts using gin (phone_digits extensions.gin_trgm_ops);

create index cached_opps_loc_idx
  on public.cached_opportunities (installation_id, location_id);
create index cached_opps_stale_idx
  on public.cached_opportunities (installation_id, status, last_stage_change_at);

create index sync_jobs_installation_status_idx
  on public.sync_jobs (installation_id, status);

-- updated_at triggers
create trigger installations_updated_at before update on public.installations
  for each row execute function public.set_updated_at();
create trigger locations_updated_at before update on public.locations
  for each row execute function public.set_updated_at();
create trigger sync_jobs_updated_at before update on public.sync_jobs
  for each row execute function public.set_updated_at();
create trigger settings_updated_at before update on public.settings
  for each row execute function public.set_updated_at();

-- RLS on, no policies, and no grants for the public API roles.
alter table public.installations enable row level security;
alter table public.locations enable row level security;
alter table public.cached_contacts enable row level security;
alter table public.cached_opportunities enable row level security;
alter table public.sync_jobs enable row level security;
alter table public.settings enable row level security;

revoke all on public.installations from anon, authenticated;
revoke all on public.locations from anon, authenticated;
revoke all on public.cached_contacts from anon, authenticated;
revoke all on public.cached_opportunities from anon, authenticated;
revoke all on public.sync_jobs from anon, authenticated;
revoke all on public.settings from anon, authenticated;
