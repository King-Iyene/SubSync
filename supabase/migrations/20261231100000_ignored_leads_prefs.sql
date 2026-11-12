-- Clients ignoring leads (flag sp_ignored_leads): the alert choices, for the company (scope '') or one client account. Additive only.
create table if not exists public.ignored_leads_prefs (
  installation_id uuid not null references public.installations (id) on delete cascade,
  scope text not null default '',
  value jsonb not null default '{}',
  updated_at timestamptz not null default now(),
  primary key (installation_id, scope)
);
alter table public.ignored_leads_prefs enable row level security;
