-- Cash features (docs/features/CASH_FEATURES.md): the morning "save this account" digest, the missed-lead recovery list and the stale / lost deal alerts.
-- Everything here is SubSync's own record. Nothing is written to the CRM from these tables and nothing is sent to a lead. Additive only.

-- 1. Digest choices per business (the hour is the business's local time; quiet hours are local too). One digest, not many pings.
create table if not exists public.cf_prefs (
  installation_id uuid primary key references public.installations (id) on delete cascade,
  save_on boolean not null default false,
  save_hour integer not null default 7,
  quiet_days integer[] not null default '{}',
  quiet_from integer,
  quiet_to integer,
  recipients text[] not null default '{}',
  last_sent_key text,
  updated_by text,
  updated_at timestamptz not null default now()
);
alter table public.cf_prefs enable row level security;
revoke all on public.cf_prefs from anon, authenticated;

-- 2. Per-account mute of the digest (SubSync only). A released or finished row stays as the log.
create table if not exists public.cf_mutes (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null references public.installations (id) on delete cascade,
  location_id text not null,
  until_at timestamptz not null,
  created_by text,
  created_at timestamptz not null default now(),
  released_at timestamptz
);
create index if not exists cf_mutes_inst_idx on public.cf_mutes (installation_id, location_id, until_at desc);
alter table public.cf_mutes enable row level security;
revoke all on public.cf_mutes from anon, authenticated;

-- 3. The recovery ledger: one row per missed lead (kind unanswered, missed_call or no_show). The sweep adds what is open, keeps the estimate,
--    and closes a row when the proof shows it was handled (a person replied, called back or the person was booked again). recovered_how says how,
--    so only real recoveries count in the "recovered" line. snoozed_until hides a row for a while (SubSync only).
create table if not exists public.cf_recover_items (
  installation_id uuid not null references public.installations (id) on delete cascade,
  location_id text not null,
  kind text not null check (kind in ('unanswered', 'missed_call', 'no_show')),
  contact_id text not null,
  ref_id text not null default '',
  contact_name text,
  owner_id text,
  est_value numeric,
  value_basis text check (value_basis in ('deal', 'average')),
  since_at timestamptz not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  recovered_at timestamptz,
  recovered_how text check (recovered_how in ('replied', 'called_back', 'rebooked', 'dropped')),
  snoozed_until timestamptz,
  snoozed_by text,
  primary key (installation_id, location_id, kind, contact_id, ref_id)
);
create index if not exists cf_recover_open_idx on public.cf_recover_items (installation_id, est_value desc nulls last, since_at) where recovered_at is null;
create index if not exists cf_recover_done_idx on public.cf_recover_items (installation_id, recovered_at desc) where recovered_at is not null;
alter table public.cf_recover_items enable row level security;
revoke all on public.cf_recover_items from anon, authenticated;

-- 4. Deal flags: a deal going stale for its stage (stale), about to (soon), or lost (lost, with the reason only when the CRM recorded one).
--    resolved_how tells what happened after: moved (the stage changed), won, lost or closed. Feeds "deals that moved after we flagged them".
create table if not exists public.cf_deal_flags (
  installation_id uuid not null references public.installations (id) on delete cascade,
  location_id text not null,
  opportunity_id text not null,
  kind text not null check (kind in ('stale', 'soon', 'lost')),
  contact_id text,
  contact_name text,
  deal_name text,
  stage_id text,
  stage_name text,
  value numeric not null default 0,
  days_in_stage numeric,
  limit_days numeric,
  limit_is_estimate boolean not null default true,
  lost_reason text,
  owner_id text,
  first_flagged_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_how text check (resolved_how in ('moved', 'won', 'lost', 'closed', 'escalated')),
  primary key (installation_id, location_id, opportunity_id, kind)
);
create index if not exists cf_deal_flags_open_idx on public.cf_deal_flags (installation_id, kind, value desc) where resolved_at is null;
alter table public.cf_deal_flags enable row level security;
revoke all on public.cf_deal_flags from anon, authenticated;

-- 5. When each sweep last ran for a business (so a screen never re-runs a sweep that just ran).
create table if not exists public.cf_state (
  installation_id uuid primary key references public.installations (id) on delete cascade,
  recover_at timestamptz,
  deals_at timestamptz,
  history_starts date
);
alter table public.cf_state enable row level security;
revoke all on public.cf_state from anon, authenticated;
