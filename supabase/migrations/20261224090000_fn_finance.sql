-- Finance module (stage FN). Additive only. Not applied by hand: it ships through the pull request check and the production approval.
-- Our own records (the platform only shows "now"): a daily money snapshot per client account (the MRR history), plus the agency's own SubSync-only entries:
-- plan prices, ad spend, commission rates, payout periods and disputes, churn-watch choices, and a billing-notes ledger. Nothing here is written to the CRM.
-- Every table has installation_id first in its key; RLS is on and the browser roles have no access.
do $$
begin
  -- Settings: payout basis (what a payout is paid on), the payout currency and the days between an appointment and a deal that counts as its result.
  create table if not exists public.fn_settings (
    installation_id uuid primary key references public.installations (id) on delete cascade,
    payout_basis text not null default 'won' check (payout_basis in ('booked', 'showed', 'won')),
    currency text not null default 'USD',
    deal_window_days integer not null default 30 check (deal_window_days between 7 and 180),
    updated_by text,
    updated_at timestamptz not null default now()
  );
  alter table public.fn_settings enable row level security;
  revoke all on public.fn_settings from anon, authenticated;

  -- Plan prices the agency typed in once, only where the platform does not give a price. plan_key is the plan id, else the plan name.
  create table if not exists public.fn_plan_prices (
    installation_id uuid not null references public.installations (id) on delete cascade,
    plan_key text not null,
    plan_name text,
    amount numeric not null check (amount >= 0),
    currency text not null default 'USD',
    billing_interval text not null default 'month' check (billing_interval in ('month', 'year')),
    updated_by text,
    updated_at timestamptz not null default now(),
    primary key (installation_id, plan_key)
  );
  alter table public.fn_plan_prices enable row level security;
  revoke all on public.fn_plan_prices from anon, authenticated;

  -- The daily money record: one row per client account per day. Written by the daily sweep (idempotent), read for the trend and the waterfall. Starts the day recording starts.
  create table if not exists public.fn_mrr_snapshot (
    installation_id uuid not null references public.installations (id) on delete cascade,
    location_id text not null,
    day date not null,
    plan_key text,
    plan_name text,
    pay text not null default 'unknown',
    monthly numeric,
    currency text,
    source text not null default 'none' check (source in ('platform', 'entered', 'none')),
    recorded_at timestamptz not null default now(),
    primary key (installation_id, location_id, day)
  );
  create index if not exists fn_mrr_snapshot_day_idx on public.fn_mrr_snapshot (installation_id, day desc);
  alter table public.fn_mrr_snapshot enable row level security;
  revoke all on public.fn_mrr_snapshot from anon, authenticated;

  -- Ad spend the agency typed in per client account per month (the platform does not give it to us).
  create table if not exists public.fn_ad_spend (
    installation_id uuid not null references public.installations (id) on delete cascade,
    location_id text not null,
    month date not null,
    amount numeric not null check (amount >= 0),
    currency text not null default 'USD',
    updated_by text,
    updated_at timestamptz not null default now(),
    primary key (installation_id, location_id, month)
  );
  alter table public.fn_ad_spend enable row level security;
  revoke all on public.fn_ad_spend from anon, authenticated;

  -- Churn watch choices per client account: who owns it, whether it is snoozed, and where the save attempt stands.
  create table if not exists public.fn_churn_state (
    installation_id uuid not null references public.installations (id) on delete cascade,
    location_id text not null,
    owner_user_id text,
    status text not null default 'open' check (status in ('open', 'working', 'saved', 'lost')),
    snoozed_until timestamptz,
    muted boolean not null default false,
    note text,
    updated_by text,
    updated_at timestamptz not null default now(),
    primary key (installation_id, location_id)
  );
  alter table public.fn_churn_state enable row level security;
  revoke all on public.fn_churn_state from anon, authenticated;

  -- Commission rates. person_id '' and location_id '' mean "anyone" / "every account". The most specific row wins: person and account, person, account, role.
  create table if not exists public.fn_pay_rates (
    installation_id uuid not null references public.installations (id) on delete cascade,
    person_id text not null default '',
    location_id text not null default '',
    role text not null check (role in ('setter', 'closer')),
    pct numeric not null default 0 check (pct >= 0 and pct <= 100),
    flat numeric not null default 0 check (flat >= 0),
    updated_by text,
    updated_at timestamptz not null default now(),
    primary key (installation_id, person_id, location_id, role)
  );
  alter table public.fn_pay_rates enable row level security;
  revoke all on public.fn_pay_rates from anon, authenticated;

  -- A payout period the owner froze: its lines are copied here so a later change in the CRM never changes what was agreed.
  create table if not exists public.fn_pay_periods (
    id uuid primary key default gen_random_uuid(),
    installation_id uuid not null references public.installations (id) on delete cascade,
    label text not null,
    date_from date not null,
    date_to date not null,
    basis text not null check (basis in ('booked', 'showed', 'won')),
    currency text not null default 'USD',
    status text not null default 'frozen' check (status in ('frozen')),
    line_count integer not null default 0,
    accounts integer not null default 0,
    total numeric not null default 0,
    frozen_by text,
    frozen_at timestamptz not null default now(),
    unique (installation_id, date_from, date_to, basis)
  );
  create index if not exists fn_pay_periods_inst_idx on public.fn_pay_periods (installation_id, date_from desc);
  alter table public.fn_pay_periods enable row level security;
  revoke all on public.fn_pay_periods from anon, authenticated;

  create table if not exists public.fn_pay_lines (
    period_id uuid not null references public.fn_pay_periods (id) on delete cascade,
    installation_id uuid not null references public.installations (id) on delete cascade,
    line_key text not null,
    location_id text not null,
    person_id text not null,
    role text not null check (role in ('setter', 'closer')),
    kind text not null check (kind in ('booked', 'showed', 'won')),
    ref_id text not null,
    at timestamptz not null,
    value numeric,
    rate_pct numeric not null default 0,
    rate_flat numeric not null default 0,
    amount numeric not null default 0,
    primary key (period_id, line_key)
  );
  create index if not exists fn_pay_lines_person_idx on public.fn_pay_lines (installation_id, person_id, period_id);
  alter table public.fn_pay_lines enable row level security;
  revoke all on public.fn_pay_lines from anon, authenticated;

  -- A flag on one payout line ("this is wrong"). Keyed by the line key so it works for a live statement and a frozen one.
  create table if not exists public.fn_pay_disputes (
    installation_id uuid not null references public.installations (id) on delete cascade,
    line_key text not null,
    location_id text not null,
    person_id text not null,
    note text,
    status text not null default 'open' check (status in ('open', 'resolved')),
    raised_by text,
    raised_at timestamptz not null default now(),
    resolved_at timestamptz,
    primary key (installation_id, line_key)
  );
  alter table public.fn_pay_disputes enable row level security;
  revoke all on public.fn_pay_disputes from anon, authenticated;

  -- Billing notes: what the agency bills each client. SubSync-only notes, not synced to the platform and never sent to anyone.
  create table if not exists public.fn_ledger (
    id uuid primary key default gen_random_uuid(),
    installation_id uuid not null references public.installations (id) on delete cascade,
    location_id text not null,
    label text not null,
    amount numeric not null check (amount >= 0),
    currency text not null default 'USD',
    due_on date not null,
    status text not null default 'unpaid' check (status in ('unpaid', 'paid')),
    paid_on date,
    remind_on date,
    note text,
    created_by text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );
  create index if not exists fn_ledger_due_idx on public.fn_ledger (installation_id, status, due_on, id);
  create index if not exists fn_ledger_loc_idx on public.fn_ledger (installation_id, location_id, due_on desc);
  alter table public.fn_ledger enable row level security;
  revoke all on public.fn_ledger from anon, authenticated;
end $$;
