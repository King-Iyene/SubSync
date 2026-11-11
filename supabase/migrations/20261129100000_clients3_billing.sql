-- Clients billing view: what the platform says about each client account's plan, read by the hourly sweep (optional permission). Only values the platform returned are stored; nothing is invented.
-- state: ok | needs_permission | not_available. Additive only.
create table if not exists public.client_billing (
  installation_id uuid not null references public.installations (id) on delete cascade,
  location_id text not null,
  state text not null default 'not_available',
  plan_id text,
  plan_name text,
  subscription_status text,
  fetched_at timestamptz not null default now(),
  primary key (installation_id, location_id)
);
alter table public.client_billing enable row level security;
revoke all on public.client_billing from anon, authenticated;
