-- Additive: Today's Growth tab. Two small tables that belong to SubSync (nothing here is ever sent to the CRM, and neither is read by any other module).
--   growth_goals     one monthly email-lead goal per client account
--   growth_settings  one row per company: leave out role addresses (info@, sales@) and which email domains are the company's own staff
-- If this has not been applied yet, Today answers "needs the latest database update" for these two things and everything else works. Safe to run twice.

create table if not exists public.growth_goals (
  installation_id uuid not null references public.installations (id) on delete cascade,
  location_id text not null,
  monthly_goal integer not null check (monthly_goal >= 1 and monthly_goal <= 1000000),
  set_by text,
  updated_at timestamptz not null default now(),
  primary key (installation_id, location_id)
);
alter table public.growth_goals enable row level security;

create table if not exists public.growth_settings (
  installation_id uuid primary key references public.installations (id) on delete cascade,
  exclude_role_addresses boolean not null default true,
  internal_domains text[] not null default '{}',
  updated_at timestamptz not null default now()
);
alter table public.growth_settings enable row level security;
