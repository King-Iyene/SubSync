-- Pipeline rollup: the deals of each account, already counted by the same rules as the live scan (value, owner, test, outlier, stuck), summed into a small table
-- so the Pipeline screens read a few thousand rows instead of every deal. Written by the refresh job (hourly sweep, after sync); the screens fall back to the live scan when it is empty or older than two hours.
create table if not exists public.pipeline_rollup (
  installation_id uuid not null,
  location_id text not null,
  pipeline_id text not null,
  stage_id text not null default '',
  owner_id text not null default '',
  source text not null default '',
  status text not null,
  is_test boolean not null,
  oos boolean not null,
  has_value boolean not null,
  has_owner boolean not null,
  outlier boolean not null,
  stale boolean not null,
  big_untouched boolean not null default false,
  closed_day date not null default date '1970-01-01',
  lost_reason text not null default '',
  n integer not null,
  value double precision not null,
  med_days double precision,
  norm_days double precision,
  stays integer,
  refreshed_at timestamptz not null default now(),
  primary key (installation_id, location_id, pipeline_id, stage_id, owner_id, source, status, is_test, oos, has_value, has_owner, outlier, stale, big_untouched, closed_day, lost_reason)
);
alter table public.pipeline_rollup enable row level security;
revoke all on public.pipeline_rollup from anon, authenticated;

create table if not exists public.pipeline_rollup_state (
  installation_id uuid not null,
  location_id text not null,
  refreshed_at timestamptz not null default now(),
  deals integer not null default 0,
  rows_written integer not null default 0,
  primary key (installation_id, location_id)
);
alter table public.pipeline_rollup_state enable row level security;
revoke all on public.pipeline_rollup_state from anon, authenticated;

create index if not exists cached_opportunities_synced_idx on public.cached_opportunities (installation_id, location_id, synced_at);
