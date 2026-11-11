-- Payments module (docs/features/PAYMENTS_BRIEF.md). Additive and idempotent. Not applied automatically (King approves the production apply).
-- pm_items: the CURRENT state of each payment thing we read (transaction, invoice, subscription, client paid plan). pm_events: append-only history of every status change (the moat).
-- pm_notes: contacted, snooze, dismiss, note (append-only; the latest row per item decides). pm_disputes: the manual dispute log (the platform has no disputes data).
-- pm_sync_state: where each account's read stopped. pm_rollup_daily: one row per account, day and currency, so a million rows never need scanning for a total.
-- installation_id is first in every key and index; RLS on, no access for the browser roles.
create table if not exists public.pm_items (
  installation_id uuid not null references public.installations (id) on delete cascade,
  location_id text not null,
  kind text not null check (kind in ('transaction', 'invoice', 'subscription', 'plan')),
  item_id text not null,
  status_raw text,
  status_mapped text not null default 'other',
  problem_kind text check (problem_kind is null or problem_kind in ('failed_payment', 'late_invoice', 'past_due_plan', 'failed_subscription')),
  amount numeric,
  amount_refunded numeric,
  currency text,
  unit_check text not null default 'assumed_major',
  due_date date,
  contact_id text,
  contact_name text,
  contact_email text,
  plan_name text,
  source_name text,
  live_mode boolean not null default true,
  occurred_at timestamptz,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  problem_since timestamptz,
  resolved_at timestamptz,
  rank_score numeric not null default 0,
  primary key (installation_id, location_id, kind, item_id)
);
create index if not exists pm_items_queue_idx on public.pm_items (installation_id, rank_score desc, location_id, kind, item_id) where problem_kind is not null and resolved_at is null;
create index if not exists pm_items_loc_idx on public.pm_items (installation_id, location_id, kind, occurred_at desc);
create index if not exists pm_items_resolved_idx on public.pm_items (installation_id, resolved_at desc) where resolved_at is not null;
alter table public.pm_items enable row level security;
revoke all on public.pm_items from anon, authenticated;

create table if not exists public.pm_events (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null references public.installations (id) on delete cascade,
  location_id text not null default '',
  kind text not null,
  item_id text not null,
  from_status text,
  to_status text not null,
  amount numeric,
  currency text,
  occurred_at timestamptz not null,
  observed_at timestamptz not null default now(),
  raw jsonb
);
create unique index if not exists pm_events_once_idx on public.pm_events (installation_id, kind, item_id, to_status, occurred_at);
create index if not exists pm_events_item_idx on public.pm_events (installation_id, location_id, kind, item_id, occurred_at);
create index if not exists pm_events_time_idx on public.pm_events (installation_id, occurred_at desc);
alter table public.pm_events enable row level security;
revoke all on public.pm_events from anon, authenticated;

create table if not exists public.pm_notes (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null references public.installations (id) on delete cascade,
  location_id text not null,
  kind text not null,
  item_id text not null,
  action text not null check (action in ('contacted', 'snooze', 'dismiss', 'note')),
  reason text,
  note text,
  until_at timestamptz,
  by_user text,
  by_name text,
  at timestamptz not null default now()
);
create index if not exists pm_notes_item_idx on public.pm_notes (installation_id, location_id, kind, item_id, at desc);
alter table public.pm_notes enable row level security;
revoke all on public.pm_notes from anon, authenticated;

create table if not exists public.pm_disputes (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null references public.installations (id) on delete cascade,
  location_id text not null,
  customer text not null,
  amount numeric,
  currency text,
  reason text,
  opened_on date not null,
  evidence_due_on date,
  status text not null default 'open' check (status in ('open', 'evidence_sent', 'won', 'lost')),
  processor_url text,
  notes text,
  created_by text,
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists pm_disputes_idx on public.pm_disputes (installation_id, status, evidence_due_on);
alter table public.pm_disputes enable row level security;
revoke all on public.pm_disputes from anon, authenticated;

create table if not exists public.pm_sync_state (
  installation_id uuid not null references public.installations (id) on delete cascade,
  location_id text not null,
  resource text not null,
  cursor_at timestamptz,
  last_ok_at timestamptz,
  last_http int,
  last_error text,
  rows_seen int not null default 0,
  primary key (installation_id, location_id, resource)
);
alter table public.pm_sync_state enable row level security;
revoke all on public.pm_sync_state from anon, authenticated;

create table if not exists public.pm_rollup_daily (
  installation_id uuid not null references public.installations (id) on delete cascade,
  location_id text not null,
  day date not null,
  currency text not null default '',
  failed_count int not null default 0,
  failed_amount numeric not null default 0,
  late_count int not null default 0,
  late_amount numeric not null default 0,
  recovered_count int not null default 0,
  recovered_amount numeric not null default 0,
  refund_count int not null default 0,
  refund_amount numeric not null default 0,
  primary key (installation_id, location_id, day, currency)
);
alter table public.pm_rollup_daily enable row level security;
revoke all on public.pm_rollup_daily from anon, authenticated;
