-- Clean-up module, version 2 (stage CLEANUP). Additive and idempotent: three new nullable or defaulted columns and one new table. Nothing is dropped, renamed or tightened;
-- the old code never reads any of it, and the new code works without it (an account without a saved choice uses the Balanced rules, nobody has write access switched on,
-- and a missing snapshot table simply means "no history yet").
--
-- locations.cleanup_rules         the duplicate-matching and "which value wins" choices for ONE client account (typed by a person on the Clean-up page). Null = use the company default.
-- locations.cleanup_write_enabled the per-account opt-in for changing contacts from SubSync. Off by default; a person switches it on in Settings. Even then nothing is sent
--                                 while the server's master switch (WRITE_GHL_LIVE) is off.
-- settings.cleanup_defaults       the same choices for the whole company (portfolio-wide rules); an account's own choice overrides it.
-- cleanup_quality_snapshots       one row per client account per day: the data-quality score and its parts, so a trend can be shown from SubSync's own record. Counts and ids only.
alter table public.locations add column if not exists cleanup_rules jsonb;
alter table public.locations add column if not exists cleanup_write_enabled boolean not null default false;
alter table public.settings add column if not exists cleanup_defaults jsonb;

create table if not exists public.cleanup_quality_snapshots (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null references public.installations (id) on delete cascade,
  location_id text not null,
  day date not null,
  contacts integer not null default 0,
  score integer,
  parts jsonb not null default '{}'::jsonb,
  counts jsonb not null default '{}'::jsonb,
  duplicate_groups integer not null default 0,
  duplicate_extra integer not null default 0,
  new_groups integer not null default 0,
  created_at timestamptz not null default now(),
  unique (installation_id, location_id, day)
);
create index if not exists cleanup_quality_snapshots_installation_idx on public.cleanup_quality_snapshots (installation_id, day desc);
alter table public.cleanup_quality_snapshots enable row level security;
