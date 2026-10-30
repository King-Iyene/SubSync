-- Additive: feature switches kept in the database (so a feature can be turned on or off without a deploy),
-- and an append-only record of appointment changes (part of the event store). Nothing here changes or
-- removes existing data.

create table if not exists public.feature_flags (
  key text primary key,
  enabled boolean not null,
  note text,
  updated_at timestamptz not null default now()
);
alter table public.feature_flags enable row level security;

-- One row each time an appointment is first seen or its status or time changes. SubSync records this
-- itself because the platform keeps no history. It is never edited.
create table if not exists public.appointment_events (
  id bigint generated always as identity primary key,
  installation_id uuid not null references public.installations (id) on delete cascade,
  location_id text not null,
  appointment_id text not null,
  kind text not null check (kind in ('created', 'status', 'time')),
  from_value text,
  to_value text,
  start_at timestamptz,
  occurred_at timestamptz not null default now()
);
create index if not exists appointment_events_install_idx on public.appointment_events (installation_id, location_id, occurred_at desc);
create index if not exists appointment_events_appt_idx on public.appointment_events (installation_id, appointment_id);
alter table public.appointment_events enable row level security;
