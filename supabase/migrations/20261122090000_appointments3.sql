-- Appointments round 3 (stage AD). Additive and idempotent only. Metadata only: never message text.

-- 1. The raw history of every appointment, append-only (history cannot be rebuilt later). One row per fact, idempotent by event_key.
--    actor_kind says who did it: 'person' (a team member in the CRM), 'subsync' (our own write, excluded from our metrics), 'system' (the platform).
create table if not exists public.appointment_history (
  id bigint generated always as identity primary key,
  installation_id uuid not null references public.installations (id) on delete cascade,
  location_id text not null,
  appointment_id text not null,
  contact_id text,
  kind text not null check (kind in ('created', 'status', 'time', 'owner', 'calendar', 'booker', 'reminder', 'confirmed', 'deal_linked', 'rescheduled_from', 'deleted', 'note')),
  event_key text not null,
  from_value text,
  to_value text,
  actor_id text,
  actor_kind text not null default 'unknown' check (actor_kind in ('person', 'subsync', 'system', 'unknown')),
  start_at timestamptz,
  at timestamptz not null,
  detail jsonb not null default '{}'::jsonb,
  recorded_at timestamptz not null default now(),
  unique (installation_id, location_id, event_key)
);
create index if not exists appointment_history_appt_idx on public.appointment_history (installation_id, location_id, appointment_id, at);
create index if not exists appointment_history_time_idx on public.appointment_history (installation_id, kind, at desc);
alter table public.appointment_history enable row level security;
revoke all on public.appointment_history from anon, authenticated;

create or replace function public.appointment_history_append_only() returns trigger language plpgsql as $$
begin
  raise exception 'appointment_history is append-only';
end;
$$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'appointment_history_no_update' and tgrelid = 'public.appointment_history'::regclass) then
    create trigger appointment_history_no_update before update on public.appointment_history
      for each row execute function public.appointment_history_append_only();
  end if;
end $$;

-- 2. One row per appointment of facts we keep ourselves (the platform does not): reminders, confirmation, the reschedule chain, a snooze.
create table if not exists public.appointment_facts (
  installation_id uuid not null references public.installations (id) on delete cascade,
  location_id text not null,
  appointment_id text not null,
  reminders_sent integer not null default 0,
  last_reminder_at timestamptz,
  confirmed_at timestamptz,
  reschedule_count integer not null default 0,
  rescheduled_from text,
  snoozed_until timestamptz,
  deleted_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (installation_id, location_id, appointment_id)
);
create index if not exists appointment_facts_snooze_idx on public.appointment_facts (installation_id, snoozed_until) where snoozed_until is not null;
alter table public.appointment_facts enable row level security;
revoke all on public.appointment_facts from anon, authenticated;

-- 3. The days between an appointment and a deal that counts as its result (default 30; the account may change it).
alter table public.settings add column if not exists appointment_deal_window_days integer;

-- 4. Indexes the aggregates need at millions of rows.
create index if not exists cached_appointments_created_idx on public.cached_appointments (installation_id, location_id, created_remote_at);
create index if not exists cached_appointments_status_start_idx on public.cached_appointments (installation_id, status, start_at);
create index if not exists cached_appointments_calendar_idx on public.cached_appointments (installation_id, location_id, calendar_id, start_at);
