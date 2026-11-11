-- Today: the daily ledger of "things that needed someone" per client account (account-local day) and kind. The hourly sweep upserts one row per account, day and kind
-- from the same counts the screen shows, so what was found and what was cleared is recorded as it happens (history cannot be rebuilt later). Append-only in spirit:
-- a sweep only ever adds to today's row; running it twice with the same counts changes nothing (idempotent). The first row of a kind is a baseline (not counted as found).
-- Additive only.
create table if not exists public.td_daily_items (
  installation_id uuid not null references public.installations (id) on delete cascade,
  location_id text not null,
  day date not null,
  kind text not null,
  last_count integer not null default 0,
  peak_count integer not null default 0,
  found integer not null default 0,
  cleared integer not null default 0,
  opened integer not null default 0,
  baseline boolean not null default false,
  open_since timestamptz,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_cleared_at timestamptz,
  resolved_at timestamptz,
  fix_minutes integer[] not null default '{}',
  primary key (installation_id, location_id, day, kind)
);
create index if not exists td_daily_items_day_idx on public.td_daily_items (installation_id, day desc);
alter table public.td_daily_items enable row level security;
revoke all on public.td_daily_items from anon, authenticated;
