-- Additive: the Data health module. All SubSync's own tables; nothing here is sent to the CRM except through the guarded fix path
-- (optional contacts.write permission, DATA_HEALTH_WRITE_LIVE, preview, signed confirm, daily cap, 24 hour undo). Safe to run twice.

-- One row per client account per day: the score and every component. Kept for the life of the install (deleted only by the uninstall purge).
create table if not exists public.dh_snapshots (
  installation_id uuid not null references public.installations (id) on delete cascade,
  location_id text not null,
  day date not null,
  score integer,
  total integer not null default 0,
  components jsonb not null default '[]'::jsonb,
  bucket text,
  taken_at timestamptz not null default now(),
  primary key (installation_id, location_id, day)
);
create index if not exists dh_snapshots_bucket_idx on public.dh_snapshots (bucket, day desc);

-- Every flagged record (id only, never a name) with when it was first seen and when it stopped being flagged.
create table if not exists public.dh_flags (
  installation_id uuid not null references public.installations (id) on delete cascade,
  location_id text not null,
  contact_id text not null,
  rule text not null,
  first_seen_day date not null,
  last_seen_day date not null,
  fixed_at timestamptz,
  primary key (installation_id, location_id, contact_id, rule)
);
create index if not exists dh_flags_open_idx on public.dh_flags (installation_id, location_id, rule) where fixed_at is null;

-- What people decided in SubSync about a record: ignore it, mark it fixed, put it in a queue with an owner and a note. Never written to the CRM.
create table if not exists public.dh_marks (
  installation_id uuid not null references public.installations (id) on delete cascade,
  location_id text not null,
  contact_id text not null,
  state text not null default 'todo',
  owner text,
  note text,
  updated_by text,
  updated_at timestamptz not null default now(),
  primary key (installation_id, location_id, contact_id)
);

-- Saved rules per account ('*' means every account): junk words, stale days, phone region, alert minimum, benchmark opt-out.
create table if not exists public.dh_rules (
  installation_id uuid not null references public.installations (id) on delete cascade,
  location_id text not null default '*',
  junk_words text[] not null default '{}',
  stale_days integer,
  phone_region text,
  spike_min integer,
  benchmark_opt_out boolean not null default false,
  updated_by text,
  updated_at timestamptz not null default now(),
  primary key (installation_id, location_id)
);

-- Safe fixes: the value before and after, so the 24 hour undo can put the old one back. op_key makes a confirm press idempotent.
create table if not exists public.dh_changes (
  id bigserial primary key,
  installation_id uuid not null references public.installations (id) on delete cascade,
  location_id text not null,
  contact_id text not null,
  field text not null,
  before_value text,
  after_value text,
  outcome text not null default 'done',
  actor_key text,
  actor_name text,
  op_key text not null,
  undoes bigint,
  undone_at timestamptz,
  created_at timestamptz not null default now(),
  unique (installation_id, op_key)
);
create index if not exists dh_changes_recent_idx on public.dh_changes (installation_id, location_id, created_at desc);

-- Proof loop: every data health alert, when it was raised and when and how it ended.
create table if not exists public.dh_outcomes (
  id bigserial primary key,
  installation_id uuid not null references public.installations (id) on delete cascade,
  location_id text,
  dedupe_key text not null,
  title text not null,
  raised_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by text,
  how text,
  unique (installation_id, dedupe_key)
);

alter table public.dh_snapshots enable row level security;
alter table public.dh_flags enable row level security;
alter table public.dh_marks enable row level security;
alter table public.dh_rules enable row level security;
alter table public.dh_changes enable row level security;
alter table public.dh_outcomes enable row level security;
revoke all on public.dh_snapshots, public.dh_flags, public.dh_marks, public.dh_rules, public.dh_changes, public.dh_outcomes from anon, authenticated;
