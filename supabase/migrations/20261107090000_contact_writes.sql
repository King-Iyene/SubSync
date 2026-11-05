-- Additive: what SubSync writes to a lead in the CRM from the contact panel (a note, or a call result with its note, tag and follow-up task).
-- Ids and statuses only (the note text is never kept here). Holds the ids the CRM gave, so Undo can remove exactly what we created, a retry never writes twice
-- (unique idempotency key) and our own write is never counted as activity. If this has not been applied, the panel says it needs the latest database update. Safe to run twice.
create table if not exists public.contact_writes (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null references public.installations (id) on delete cascade,
  location_id text not null,
  contact_id text not null,
  kind text not null check (kind in ('note', 'outcome', 'tag_add', 'tag_remove')),
  outcome text,
  idem_key text not null,
  actor text,
  actor_name text,
  status text not null default 'pending' check (status in ('pending', 'saved', 'dry_run', 'failed', 'needs_permission', 'undone')),
  note_id text,
  task_id text,
  tag text,
  tag_added boolean not null default false,
  detail text,
  created_at timestamptz not null default now(),
  undone_at timestamptz,
  unique (installation_id, idem_key)
);
create index if not exists contact_writes_hour_idx on public.contact_writes (installation_id, created_at desc);
create index if not exists contact_writes_echo_idx on public.contact_writes (installation_id, note_id) where note_id is not null;
alter table public.contact_writes enable row level security;
-- Tag dates: a tag SubSync itself added or removed has the exact time; one SubSync only noticed at a sync is the day it first saw it (exact = false).
alter table public.contact_tag_events add column if not exists exact boolean not null default false;

