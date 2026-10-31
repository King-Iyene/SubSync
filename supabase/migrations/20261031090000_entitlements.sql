-- Additive: which tier each marketplace plan id gives (so swapping a plan is a row change, never a
-- deploy), and the plan each client account is on as the platform reports it. Nothing here changes or
-- removes existing data. The app reads both tables defensively: if they are empty or unreadable it
-- behaves as before.

create table if not exists public.plan_entitlements (
  plan_id text primary key,
  tier text not null check (tier in ('free', 'pro')),
  note text,
  updated_at timestamptz not null default now()
);
alter table public.plan_entitlements enable row level security;

-- One row per client account (or one for the whole install when no account is named), from the install
-- and plan-change events.
create table if not exists public.install_plans (
  id bigint generated always as identity primary key,
  installation_id uuid not null references public.installations (id) on delete cascade,
  location_id text not null default '',
  plan_id text,
  on_trial boolean not null default false,
  trial_days integer,
  updated_at timestamptz not null default now(),
  unique (installation_id, location_id)
);
create index if not exists install_plans_installation_idx on public.install_plans (installation_id);
alter table public.install_plans enable row level security;
