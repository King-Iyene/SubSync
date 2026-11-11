-- Account audit settings (slice 4): the monthly re-audit email is on or off for the company, and can be muted for one client account. The last key stops a second
-- email in the same month. SubSync-only settings; nothing here is sent to or read from the CRM. Additive only.
create table if not exists public.au_prefs (
  installation_id uuid primary key references public.installations (id) on delete cascade,
  monthly_on boolean not null default true,
  last_monthly_key text,
  updated_at timestamptz not null default now()
);
alter table public.au_prefs enable row level security;

create table if not exists public.au_account_prefs (
  installation_id uuid not null references public.installations (id) on delete cascade,
  location_id text not null,
  monthly_muted boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (installation_id, location_id)
);
alter table public.au_account_prefs enable row level security;
