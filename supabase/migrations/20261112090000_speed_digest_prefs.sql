-- Speed to lead, stage SPEED6 (additive only; do not apply by hand, the deploy workflow applies it).
-- 1. The Speed summary message per account (or company-wide when location_id is ''): recipients, channels, schedule, editable text, which lines, enabled flag. last_sent_key makes a send idempotent per day or week.
create table if not exists public.speed_digest (
  installation_id uuid not null references public.installations (id) on delete cascade,
  location_id text not null default '',
  settings jsonb not null default '{}'::jsonb,
  last_sent_key text,
  updated_at timestamptz not null default now(),
  primary key (installation_id, location_id)
);
alter table public.speed_digest enable row level security;

-- 2. Call mode and Speed choices that used to live only in a browser: the redial plan ('cadence'), hour goals ('goals'), scripts per lead source ('scripts') and outcome sets ('dispositions').
-- scope is '' for the whole company or a location id for one client account.
create table if not exists public.speed_prefs (
  installation_id uuid not null references public.installations (id) on delete cascade,
  scope text not null default '',
  key text not null check (key in ('cadence', 'goals', 'scripts', 'dispositions')),
  value jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (installation_id, scope, key)
);
alter table public.speed_prefs enable row level security;
