-- Round 6 speed. Additive and idempotent. Not applied by hand: it ships through the pull request (fresh-database check), then the production apply is approved by King.
--
-- One row per client account holding the finished numbers every screen starts with (contacts, deals, waiting counts, unmarked appointments, the score history). It is
-- refreshed at the end of every sync and when something changes, so "all accounts with numbers" is ONE indexed lookup instead of five scans of the big tables.
-- settings_key says which counting rules the row was made under (stale days, reply hours, reply target, deal rules); a row made under other rules is never used.
-- "dirty" is set by any change made through SubSync, so the next read recomputes instead of showing the old number.
create table if not exists public.account_rollup (
  installation_id uuid not null references public.installations (id) on delete cascade,
  location_id text not null,
  settings_key text not null,
  computed_at timestamptz not null default now(),
  dirty boolean not null default false,
  row_json jsonb not null,
  history_json jsonb not null default '{}'::jsonb,
  primary key (installation_id, location_id)
);
create index if not exists account_rollup_fresh_idx on public.account_rollup (installation_id, computed_at desc);
alter table public.account_rollup enable row level security;

-- The finished answer of the heavy screens (Today, Speed to lead, Appointments, Clients, Clean-up, Accounts), kept per installation + who is asking + the exact address, so a first click
-- on a cold server instance is one lookup. Same dirty rule as above: any change made through SubSync marks them, and the next read makes a new one. Never read across installations
-- (installation_id is the first part of the key) and never across people (the key holds who is asking).
create table if not exists public.read_answers (
  installation_id uuid not null references public.installations (id) on delete cascade,
  answer_key text not null,
  body text not null,
  computed_at timestamptz not null default now(),
  dirty boolean not null default false,
  primary key (installation_id, answer_key)
);
alter table public.read_answers enable row level security;
