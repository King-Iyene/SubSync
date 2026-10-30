-- Additive: appointments (from the calendar events permission) and platform-provided team names.
-- Nothing here changes or removes existing data.

create table if not exists public.cached_appointments (
  installation_id uuid not null references public.installations (id) on delete cascade,
  location_id text not null,
  appointment_id text not null,
  calendar_id text,
  calendar_name text,
  contact_id text,
  title text,
  status text,
  start_at timestamptz,
  end_at timestamptz,
  assigned_to text,
  created_remote_at timestamptz,
  synced_at timestamptz not null default now(),
  primary key (installation_id, location_id, appointment_id)
);
create index if not exists cached_appointments_start_idx on public.cached_appointments (installation_id, location_id, start_at);
create index if not exists cached_appointments_contact_idx on public.cached_appointments (installation_id, location_id, contact_id);

-- 'ok' when the platform let us read events and users, 'needs_permission' when the install does
-- not have the permission yet (existing installs must re-approve to get new permissions).
alter table public.locations add column if not exists appointments_synced_at timestamptz;
alter table public.locations add column if not exists appointments_access text;
alter table public.locations add column if not exists users_access text;

-- Names typed by a person always win over names that came from the platform.
alter table public.team_names add column if not exists source text not null default 'typed';

alter table public.sync_jobs drop constraint if exists sync_jobs_type_check;
alter table public.sync_jobs add constraint sync_jobs_type_check
  check (type in ('locations', 'structure', 'contacts', 'opportunities', 'conversations', 'appointments', 'metrics'));

alter table public.cached_appointments enable row level security;
