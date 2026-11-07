-- CRM call queue (stage DIALQ): per-account settings for filling the CRM call queue (a tag a workflow listens for, or enrolling in a workflow), and a log so
-- a lead is never added twice within 24 hours. Additive only. NOT applied: apply with the usual migration step. Until then every route answers "needs the latest database update".
create table if not exists public.call_queue_settings (
  installation_id uuid not null references public.installations (id) on delete cascade,
  location_id text not null,
  route text not null default 'tag' check (route in ('tag', 'workflow')),
  tag text not null default 'subsync-call-now',
  workflow_id text,
  auto_on boolean not null default false,
  paused boolean not null default false,
  lists text[] not null default '{missed,new_unanswered,hot_uncontacted,noshow_recovery,redial}',
  max_per_run int not null default 25,
  max_per_day int not null default 100,
  window_start int not null default 9,
  window_end int not null default 20,
  last_run_at timestamptz,
  last_added int not null default 0,
  updated_at timestamptz not null default now(),
  primary key (installation_id, location_id)
);
create table if not exists public.call_queue_log (
  id bigserial primary key,
  installation_id uuid not null references public.installations (id) on delete cascade,
  location_id text not null,
  contact_id text not null,
  action text not null check (action in ('add', 'remove', 'enrol')),
  source text not null default 'auto',
  status text not null default 'saved',
  at timestamptz not null default now()
);
create index if not exists call_queue_log_recent_idx on public.call_queue_log (installation_id, location_id, contact_id, at desc);
alter table public.call_queue_settings enable row level security;
alter table public.call_queue_log enable row level security;
