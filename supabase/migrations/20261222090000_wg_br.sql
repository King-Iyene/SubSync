-- Wallet guard (wg_*) and the 7 am brief (br_*). Additive only. Nothing here is written to the CRM and nothing is sent to a lead.
-- wg_samples is SubSync's own append-only record of each client account's credit balance, one reading per platform answer: it cannot be rebuilt later (the platform shows only "now").
-- wg_state is the working result of the sweep (burn rate, days left, spike) so a screen reads one row per account.
-- br_history is the record of every brief shown or sent and what the person did next.
do $$
begin
  create table if not exists public.wg_samples (
    id bigint generated always as identity primary key,
    installation_id uuid not null references public.installations (id) on delete cascade,
    location_id text not null,
    observed_at timestamptz not null,
    balance numeric not null,
    credits numeric,
    recorded_at timestamptz not null default now(),
    unique (installation_id, location_id, observed_at)
  );
  create index if not exists wg_samples_account_idx on public.wg_samples (installation_id, location_id, observed_at desc);
  alter table public.wg_samples enable row level security;
  revoke all on public.wg_samples from anon, authenticated;

  create table if not exists public.wg_state (
    installation_id uuid not null references public.installations (id) on delete cascade,
    location_id text not null,
    wallet_state text not null default 'not_checked' check (wallet_state in ('ok', 'needs_permission', 'not_available', 'not_checked')),
    balance numeric,
    credits numeric,
    observed_at timestamptz,
    samples integer not null default 0,
    span_days numeric,
    burn_per_day numeric,
    days_left numeric,
    spent_7d numeric,
    topups_7d integer not null default 0,
    last_topup_at timestamptz,
    spike boolean not null default false,
    spike_spent numeric,
    spike_baseline numeric,
    spike_day date,
    computed_at timestamptz not null default now(),
    primary key (installation_id, location_id)
  );
  create index if not exists wg_state_rank_idx on public.wg_state (installation_id, days_left nulls last, balance);
  alter table public.wg_state enable row level security;
  revoke all on public.wg_state from anon, authenticated;

  create table if not exists public.wg_prefs (
    installation_id uuid primary key references public.installations (id) on delete cascade,
    low_amount numeric not null default 10 check (low_amount >= 0),
    low_days integer not null default 3 check (low_days between 1 and 30),
    alerts_on boolean not null default true,
    spike_on boolean not null default true,
    updated_by text,
    updated_at timestamptz not null default now()
  );
  alter table public.wg_prefs enable row level security;
  revoke all on public.wg_prefs from anon, authenticated;

  create table if not exists public.wg_rules (
    installation_id uuid not null references public.installations (id) on delete cascade,
    location_id text not null,
    low_amount numeric check (low_amount is null or low_amount >= 0),
    muted_until timestamptz,
    updated_by text,
    updated_at timestamptz not null default now(),
    primary key (installation_id, location_id)
  );
  alter table public.wg_rules enable row level security;
  revoke all on public.wg_rules from anon, authenticated;

  create table if not exists public.wg_watchers (
    installation_id uuid not null references public.installations (id) on delete cascade,
    user_key text not null,
    created_at timestamptz not null default now(),
    primary key (installation_id, user_key)
  );
  alter table public.wg_watchers enable row level security;
  revoke all on public.wg_watchers from anon, authenticated;

  create table if not exists public.wg_events (
    id bigint generated always as identity primary key,
    installation_id uuid not null references public.installations (id) on delete cascade,
    location_id text not null,
    kind text not null check (kind in ('low', 'empty', 'spike', 'recharge')),
    episode text not null,
    balance numeric,
    amount numeric,
    detail jsonb,
    at timestamptz not null default now(),
    unique (installation_id, location_id, kind, episode)
  );
  create index if not exists wg_events_inst_idx on public.wg_events (installation_id, id desc);
  alter table public.wg_events enable row level security;
  revoke all on public.wg_events from anon, authenticated;

  create table if not exists public.br_prefs (
    installation_id uuid not null references public.installations (id) on delete cascade,
    user_key text not null,
    email text,
    email_on boolean not null default false,
    hour integer not null default 7 check (hour between 0 and 23),
    timezone text not null default 'UTC',
    quiet_days integer[] not null default '{}',
    sections text[] not null default '{attention,save,recover,deals,wallet,payments}',
    last_sent_key text,
    updated_at timestamptz not null default now(),
    primary key (installation_id, user_key)
  );
  alter table public.br_prefs enable row level security;
  revoke all on public.br_prefs from anon, authenticated;

  create table if not exists public.br_history (
    id uuid primary key default gen_random_uuid(),
    installation_id uuid not null references public.installations (id) on delete cascade,
    user_key text not null,
    day text not null,
    channel text not null check (channel in ('email', 'app', 'test')),
    mode text not null check (mode in ('sent', 'dry_run', 'shown')),
    items jsonb not null default '[]'::jsonb,
    item_count integer not null default 0,
    dollars numeric,
    created_at timestamptz not null default now(),
    opened_at timestamptz,
    acted_at timestamptz,
    acted_key text
  );
  create unique index if not exists br_history_day_idx on public.br_history (installation_id, user_key, day, channel) where channel <> 'test';
  create index if not exists br_history_user_idx on public.br_history (installation_id, user_key, created_at desc);
  alter table public.br_history enable row level security;
  revoke all on public.br_history from anon, authenticated;
end $$;
