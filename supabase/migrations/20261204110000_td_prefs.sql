-- Today: SubSync-only settings and notes. td_prefs holds the daily email choice per business (the hour is the business's local time, quiet days are weekdays 0 to 6 with no email);
-- td_snoozes hides one kind of item for a day or more (for one account or all), and its own row is the log (who, when, until). Neither writes to the CRM. Additive only.
create table if not exists public.td_prefs (
  installation_id uuid not null references public.installations (id) on delete cascade,
  email_on boolean not null default false,
  email_hour integer not null default 7,
  quiet_days integer[] not null default '{}',
  recipients text[] not null default '{}',
  last_sent_key text,
  updated_by text,
  updated_at timestamptz not null default now(),
  primary key (installation_id)
);
alter table public.td_prefs enable row level security;
revoke all on public.td_prefs from anon, authenticated;

create table if not exists public.td_snoozes (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null references public.installations (id) on delete cascade,
  location_id text not null default '*',
  kind text not null,
  until_at timestamptz not null,
  created_by text,
  created_at timestamptz not null default now(),
  released_at timestamptz
);
create index if not exists td_snoozes_inst_idx on public.td_snoozes (installation_id, until_at desc);
alter table public.td_snoozes enable row level security;
revoke all on public.td_snoozes from anon, authenticated;
