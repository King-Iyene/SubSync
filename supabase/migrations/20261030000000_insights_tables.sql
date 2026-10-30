-- Additive tables for the insights features. Nothing here changes or removes existing data.

-- Per client account: what the agency charges, renewal date, industry, notes, last contact.
create table if not exists public.account_profiles (
  installation_id uuid not null references public.installations (id) on delete cascade,
  location_id text not null,
  monthly_fee numeric,
  renewal_date date,
  industry text,
  notes text,
  last_contacted_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (installation_id, location_id)
);

-- Targets for goal tracking and pipeline coverage (one row per metric).
create table if not exists public.goals (
  installation_id uuid not null references public.installations (id) on delete cascade,
  metric text not null,
  target numeric not null,
  updated_at timestamptz not null default now(),
  primary key (installation_id, metric)
);

-- Saved smart call lists (named filter combinations).
create table if not exists public.call_lists (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null references public.installations (id) on delete cascade,
  name text not null,
  filters jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists call_lists_installation_idx on public.call_lists (installation_id);

-- What happened on each call from a list, and when to follow up.
create table if not exists public.call_outcomes (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null references public.installations (id) on delete cascade,
  location_id text not null,
  contact_id text not null,
  outcome text not null check (outcome in ('answered', 'voicemail', 'no_answer', 'wrong_number', 'booked', 'not_interested', 'follow_up')),
  note text,
  follow_up_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists call_outcomes_installation_idx on public.call_outcomes (installation_id, created_at desc);
create index if not exists call_outcomes_followup_idx on public.call_outcomes (installation_id, follow_up_at) where follow_up_at is not null;

alter table public.account_profiles enable row level security;
alter table public.goals enable row level security;
alter table public.call_lists enable row level security;
alter table public.call_outcomes enable row level security;
