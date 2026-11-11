-- Today: the weekly proof receipt per client account (location_id '*' is the whole business): what we found, what was cleared, what is still open, and the
-- median time to fix. Written by the sweep for the last few weeks from td_daily_items (idempotent upsert); the current week is also read live. Additive only.
create table if not exists public.td_receipts (
  installation_id uuid not null references public.installations (id) on delete cascade,
  location_id text not null,
  week_start date not null,
  found integer not null default 0,
  cleared integer not null default 0,
  still_open integer not null default 0,
  median_fix_minutes integer,
  fixes integer not null default 0,
  history_starts date,
  updated_at timestamptz not null default now(),
  primary key (installation_id, location_id, week_start)
);
alter table public.td_receipts enable row level security;
revoke all on public.td_receipts from anon, authenticated;
