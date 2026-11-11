-- Clients v2 (client-account management). Additive only.
-- 1) What the platform says about each account's paid plan: price, billing interval, trial, raw status, since when, and the real HTTP reason when it could not be read.
-- 2) Credit balance (wallet) per account, when the optional permission is granted.
-- 3) cl2_notes: the agency's own notes, next steps and promises per account (SubSync-only, never sent anywhere).
-- 4) cl2_plan_events: our own history of plan status changes (the platform only shows "now"). History starts when the first change is seen.
do $$
begin
  alter table public.client_billing add column if not exists subscription_id text;
  alter table public.client_billing add column if not exists price_amount numeric;
  alter table public.client_billing add column if not exists price_currency text;
  alter table public.client_billing add column if not exists billing_interval text;
  alter table public.client_billing add column if not exists trial_days integer;
  alter table public.client_billing add column if not exists user_limit integer;
  alter table public.client_billing add column if not exists contact_limit integer;
  alter table public.client_billing add column if not exists status_since timestamptz;
  alter table public.client_billing add column if not exists http_status integer;
  alter table public.client_billing add column if not exists reason text;
  alter table public.client_billing add column if not exists wallet_balance numeric;
  alter table public.client_billing add column if not exists wallet_credits numeric;
  alter table public.client_billing add column if not exists wallet_state text;
  alter table public.client_billing add column if not exists wallet_at timestamptz;
end $$;

create table if not exists public.cl2_notes (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null references public.installations (id) on delete cascade,
  location_id text not null,
  kind text not null default 'note' check (kind in ('note', 'next_step', 'promise', 'plan')),
  body text not null check (char_length(body) between 1 and 2000),
  pinned boolean not null default false,
  done boolean not null default false,
  due_on date,
  author text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists cl2_notes_account_idx on public.cl2_notes (installation_id, location_id, pinned desc, created_at desc);
alter table public.cl2_notes enable row level security;
revoke all on public.cl2_notes from anon, authenticated;

create table if not exists public.cl2_plan_events (
  id bigint generated always as identity primary key,
  installation_id uuid not null references public.installations (id) on delete cascade,
  location_id text not null,
  from_status text,
  to_status text,
  plan_name text,
  at timestamptz not null default now()
);
create index if not exists cl2_plan_events_account_idx on public.cl2_plan_events (installation_id, location_id, at desc);
alter table public.cl2_plan_events enable row level security;
revoke all on public.cl2_plan_events from anon, authenticated;
