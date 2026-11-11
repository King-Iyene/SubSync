-- Appointments module, slice AB (actions and meetings). Additive and idempotent. Not applied automatically.
-- 1. Action log: one row per appointment changed from SubSync (status, reschedule, reassign, edit, create, delete, undo). Ids, times, status and owner ids only; never a name,
--    a note or a message. `before` holds what is needed to put a change back; a delete cannot be put back. Rows whose result is 'done' are SubSync's own writes: the
--    history and every metric skip the platform echo of them (rule 14).
create table if not exists public.appointment_actions (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null references public.installations (id) on delete cascade,
  location_id text not null,
  batch_id uuid not null,
  action text not null check (action in ('status', 'reschedule', 'reassign', 'edit', 'create', 'delete', 'undo')),
  appointment_id text,
  contact_id text,
  before_value jsonb not null default '{}'::jsonb,
  after_value jsonb not null default '{}'::jsonb,
  result text not null,
  actor text,
  created_at timestamptz not null default now()
);
create index if not exists appointment_actions_batch_idx on public.appointment_actions (installation_id, batch_id);
create index if not exists appointment_actions_appt_idx on public.appointment_actions (installation_id, location_id, appointment_id, created_at desc);
alter table public.appointment_actions enable row level security;
revoke all on public.appointment_actions from anon, authenticated;

-- 2. Meeting links: a recorded call (Fathom) tied to one appointment. Created only when the match is certain (one contact, one appointment, attendee email and time window agree)
--    or when the person who owns the call picks it. The call itself stays private to its owner; the link carries no content.
create table if not exists public.appointment_meeting_links (
  installation_id uuid not null references public.installations (id) on delete cascade,
  location_id text not null,
  appointment_id text not null,
  meeting_id uuid not null references public.meetings (id) on delete cascade,
  owner_ghl_user_id text not null,
  matched_by text not null check (matched_by in ('auto', 'person')),
  suggested_outcome text check (suggested_outcome in ('showed', 'noshow')),
  outcome_confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (installation_id, location_id, appointment_id, meeting_id)
);
create index if not exists appointment_meeting_links_meeting_idx on public.appointment_meeting_links (installation_id, meeting_id);
alter table public.appointment_meeting_links enable row level security;
revoke all on public.appointment_meeting_links from anon, authenticated;
