-- Additive: data cleanup runs. Every change is listed before it happens and keeps the value it replaced,
-- so a run can be undone. Nothing here changes or removes existing data.

create table if not exists public.cleanup_runs (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null references public.installations (id) on delete cascade,
  location_id text not null,
  params jsonb not null,
  status text not null default 'previewed'
    check (status in ('previewed', 'applying', 'applied', 'partial', 'undoing', 'undone', 'needs_permission', 'failed')),
  total integer not null default 0,
  applied integer not null default 0,
  skipped integer not null default 0,
  failed integer not null default 0,
  undone integer not null default 0,
  truncated boolean not null default false,
  actor text,
  note text,
  created_at timestamptz not null default now(),
  applied_at timestamptz,
  undone_at timestamptz
);
create index if not exists cleanup_runs_installation_idx on public.cleanup_runs (installation_id, created_at desc);

create table if not exists public.cleanup_changes (
  id bigserial primary key,
  run_id uuid not null references public.cleanup_runs (id) on delete cascade,
  installation_id uuid not null references public.installations (id) on delete cascade,
  location_id text not null,
  contact_id text not null,
  rule text not null,
  field text not null,
  before_value text,
  after_value text,
  tag text,
  status text not null default 'pending' check (status in ('pending', 'applied', 'skipped', 'failed', 'undone')),
  error text
);
create index if not exists cleanup_changes_run_idx on public.cleanup_changes (run_id, status, id);

alter table public.cleanup_runs enable row level security;
alter table public.cleanup_changes enable row level security;
