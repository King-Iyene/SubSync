-- Account audit history (docs/features/AUDIT_BRIEF.md, slice 1): one row per client account per day an audit was read, counted under a stated rules version.
-- Append-only and idempotent: the primary key is (installation, account, day) and a second read the same day changes nothing. The first row of an account is its
-- baseline ("Baseline at install"). Counts are per finding; null means "not checked" (for example calendars not readable). The dollar figures are an ESTIMATE kept
-- with their sample size and are never added to counted money. No names and no contact data are stored. Additive only.
create table if not exists public.au_runs (
  installation_id uuid not null references public.installations (id) on delete cascade,
  location_id text not null,
  run_day date not null,
  run_at timestamptz not null default now(),
  rules_version integer not null,
  is_baseline boolean not null default false,
  counts jsonb not null,
  stale_dollars numeric not null default 0,
  est_dollars numeric,
  est_low numeric,
  est_high numeric,
  closed_deals integer not null default 0,
  partial boolean not null default false,
  source text not null default 'view',
  primary key (installation_id, location_id, run_day)
);
create index if not exists au_runs_by_day on public.au_runs (installation_id, run_day desc);
alter table public.au_runs enable row level security;
