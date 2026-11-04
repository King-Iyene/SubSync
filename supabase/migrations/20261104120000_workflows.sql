-- Additive: the Workflows module. Four tables, all SubSync's own. Nothing here is ever sent to the CRM except through the guarded write path
-- (WORKFLOWS_WRITE_LIVE, optional permissions, preview and confirm). Safe to run twice.

-- One row per workflow per client account, refreshed by the sync. Only names, states, counts and times: never a step, a message text or a contact.
create table if not exists public.workflow_items (
  installation_id uuid not null references public.installations (id) on delete cascade,
  location_id text not null,
  workflow_id text not null,
  name text not null,
  status text not null default 'other',
  kind text,
  folder_id text,
  version text,
  ui_url text,
  remote_created_at timestamptz,
  remote_updated_at timestamptz,
  updated_by text,
  -- log counts of the last 30 days; null means the logs permission was not available, so the number is not known (never zero by guess)
  runs_30d integer,
  enrolled_30d integer,
  failed_30d integer,
  last_run_at timestamptz,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  removed_seen_at timestamptz,
  primary key (installation_id, location_id, workflow_id)
);
create index if not exists workflow_items_seen_idx on public.workflow_items (installation_id, last_seen_at desc);

-- Append-only record of what happened to a workflow: what SubSync did (source subsync) and what it noticed between two syncs (source observed).
-- Also the event store for this module: alerts raised and writes are counted from here. op_key makes a confirmed write idempotent.
create table if not exists public.workflow_changes (
  id bigint generated always as identity primary key,
  installation_id uuid not null references public.installations (id) on delete cascade,
  location_id text not null,
  workflow_id text not null,
  kind text not null,
  source text not null default 'observed',
  actor_key text,
  actor_name text,
  before jsonb,
  after jsonb,
  outcome text not null default 'done',
  undoes bigint,
  op_key text,
  created_at timestamptz not null default now()
);
create index if not exists workflow_changes_feed_idx on public.workflow_changes (installation_id, created_at desc);
create unique index if not exists workflow_changes_op_idx on public.workflow_changes (installation_id, op_key) where op_key is not null;

-- SubSync-side organisation: labels, group, rating, keep/review/retire, notes, owner. Lives only here, never written to the CRM.
create table if not exists public.workflow_labels (
  installation_id uuid not null references public.installations (id) on delete cascade,
  location_id text not null,
  workflow_id text not null,
  labels text[] not null default '{}',
  group_name text,
  rating smallint check (rating between 1 and 5),
  decision text check (decision in ('keep', 'review', 'retire')),
  note text,
  owner text,
  updated_by text,
  updated_at timestamptz not null default now(),
  primary key (installation_id, location_id, workflow_id)
);

-- A copy of a workflow's definition taken just before SubSync changes or deletes it, so it can be put back or recreated.
create table if not exists public.workflow_snapshots (
  id bigint generated always as identity primary key,
  installation_id uuid not null references public.installations (id) on delete cascade,
  location_id text not null,
  workflow_id text not null,
  name text not null,
  reason text not null,
  definition jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists workflow_snapshots_idx on public.workflow_snapshots (installation_id, workflow_id, created_at desc);

-- Our own daily history of the module (how many, how many failing, runs and errors of the last 30 days as counted that day), so a trend exists.
create table if not exists public.workflow_daily (
  installation_id uuid not null references public.installations (id) on delete cascade,
  location_id text not null,
  day date not null,
  total integer not null default 0,
  failing integer not null default 0,
  runs_30d integer,
  errors_30d integer,
  primary key (installation_id, location_id, day)
);

alter table public.workflow_daily enable row level security;
alter table public.workflow_items enable row level security;
alter table public.workflow_changes enable row level security;
alter table public.workflow_labels enable row level security;
alter table public.workflow_snapshots enable row level security;
