-- Lead intake health (Lead intake tab, Clean-up). Additive and idempotent: four new tables, nothing existing is changed. Not applied by hand: it ships through the pull request.
--   dq_health_settings   per installation: how big a drop raises the low application alert, and the smallest usual week that can raise it (defaults 50 percent and 5 a week)
--   dq_health_daily      the history: one row per form, survey or funnel per day (last 7 days, usual week, verdict, pages). The platform keeps none of this, so it cannot be rebuilt later.
--   dq_funnel_pages      the page names of each funnel (names and ids only)
--   dq_links             funnel redirects and trigger links: a name and where each one points (no contact data)
--   dq_forms.pages       a new column: the number of pages of a funnel
alter table public.dq_forms add column if not exists pages integer;

create table if not exists public.dq_health_settings (
  installation_id uuid primary key references public.installations (id) on delete cascade,
  drop_pct integer not null default 50 check (drop_pct between 10 and 90),
  min_baseline integer not null default 5 check (min_baseline between 1 and 100),
  updated_by text,
  updated_at timestamptz not null default now()
);
alter table public.dq_health_settings enable row level security;
revoke all on public.dq_health_settings from anon, authenticated;

create table if not exists public.dq_health_daily (
  installation_id uuid not null references public.installations (id) on delete cascade,
  location_id text not null,
  kind text not null check (kind in ('form', 'survey', 'funnel')),
  ext_id text not null,
  day date not null default ((now() at time zone 'UTC')::date),
  recent integer,
  usual numeric,
  drop_pct integer,
  verdict text not null,
  pages integer,
  steps integer,
  rules_version text not null default 'health-1',
  taken_at timestamptz not null default now(),
  primary key (installation_id, location_id, kind, ext_id, day)
);
create index if not exists dq_health_daily_day_idx on public.dq_health_daily (installation_id, day desc);
alter table public.dq_health_daily enable row level security;
revoke all on public.dq_health_daily from anon, authenticated;

create table if not exists public.dq_funnel_pages (
  installation_id uuid not null references public.installations (id) on delete cascade,
  location_id text not null,
  funnel_id text not null,
  page_id text not null,
  name text not null,
  step_id text,
  updated_at timestamptz,
  seen_at timestamptz not null default now(),
  primary key (installation_id, location_id, funnel_id, page_id)
);
alter table public.dq_funnel_pages enable row level security;
revoke all on public.dq_funnel_pages from anon, authenticated;

create table if not exists public.dq_links (
  installation_id uuid not null references public.installations (id) on delete cascade,
  location_id text not null,
  kind text not null check (kind in ('redirect', 'trigger')),
  ext_id text not null,
  name text not null,
  target text,
  seen_at timestamptz not null default now(),
  primary key (installation_id, location_id, kind, ext_id)
);
alter table public.dq_links enable row level security;
revoke all on public.dq_links from anon, authenticated;
