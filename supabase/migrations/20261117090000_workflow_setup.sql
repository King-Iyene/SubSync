-- Workflow setup (stage WFSETUP): which workflow SubSync set up in a client account's CRM, and the per-account setup settings. Additive only. NOT applied: apply with the usual
-- migration step. Until then every setup route answers "needs the latest database update" and nothing is sent. The template key lives only here (never in the customer's CRM).
create table if not exists public.workflow_setup (
  installation_id uuid not null references public.installations (id) on delete cascade,
  location_id text not null,
  template_key text not null,
  folder_id text,
  workflow_id text,
  template_version int not null default 1,
  status text not null default 'active' check (status in ('active', 'created_draft', 'unavailable', 'inactive')),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (installation_id, location_id, template_key)
);
create table if not exists public.workflow_setup_settings (
  installation_id uuid not null references public.installations (id) on delete cascade,
  location_id text not null,
  folder_name text,
  auto_setup boolean not null default false,
  assign_mode text not null default 'round_robin' check (assign_mode in ('round_robin', 'user')),
  assign_user_id text,
  updated_at timestamptz not null default now(),
  primary key (installation_id, location_id)
);
alter table public.workflow_setup enable row level security;
alter table public.workflow_setup_settings enable row level security;
