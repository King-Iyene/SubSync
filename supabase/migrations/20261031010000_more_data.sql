-- Additive: more fields we already have permission to read, and the small tables behind the
-- team, deal movement, timeline notes, usage and report features. Nothing here changes or
-- removes existing data.

alter table public.cached_contacts add column if not exists source text;
alter table public.cached_contacts add column if not exists dnd boolean not null default false;
alter table public.cached_contacts add column if not exists birth_date date;
alter table public.cached_contacts add column if not exists assigned_to text;
alter table public.cached_opportunities add column if not exists assigned_to text;
alter table public.cached_opportunities add column if not exists source text;

create index if not exists cached_contacts_source_idx on public.cached_contacts (installation_id, location_id, source);

-- Names for the people deals and contacts are assigned to (the platform only gives us ids until
-- the users permission is granted, so the team can name them themselves).
create table if not exists public.team_names (
  installation_id uuid not null references public.installations (id) on delete cascade,
  user_id text not null,
  name text not null,
  primary key (installation_id, user_id)
);

-- Every stage or status change we see between two syncs, from the day of install.
create table if not exists public.deal_events (
  id bigserial primary key,
  installation_id uuid not null references public.installations (id) on delete cascade,
  location_id text not null,
  opportunity_id text not null,
  kind text not null check (kind in ('created', 'stage', 'status')),
  from_value text,
  to_value text,
  value numeric,
  at timestamptz not null default now()
);
create index if not exists deal_events_installation_idx on public.deal_events (installation_id, at desc);
create index if not exists deal_events_opportunity_idx on public.deal_events (installation_id, opportunity_id);

-- Notes pinned to a date ("ran a promotion", "changed pricing").
create table if not exists public.annotations (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null references public.installations (id) on delete cascade,
  day date not null,
  text text not null,
  created_at timestamptz not null default now()
);
create index if not exists annotations_installation_idx on public.annotations (installation_id, day desc);

-- Which pages get used (counts per day, no personal data).
create table if not exists public.usage_events (
  installation_id uuid not null references public.installations (id) on delete cascade,
  day date not null,
  view text not null,
  n integer not null default 1,
  primary key (installation_id, day, view)
);

-- Saved report layouts.
create table if not exists public.report_templates (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null references public.installations (id) on delete cascade,
  name text not null,
  spec jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists report_templates_installation_idx on public.report_templates (installation_id);

-- Name and colour shown on printed reports.
alter table public.settings add column if not exists brand_name text;
alter table public.settings add column if not exists brand_color text;

alter table public.team_names enable row level security;
alter table public.deal_events enable row level security;
alter table public.annotations enable row level security;
alter table public.usage_events enable row level security;
alter table public.report_templates enable row level security;
