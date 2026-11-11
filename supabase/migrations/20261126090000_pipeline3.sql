-- Pipeline and deals round 3 (stage PD). Additive and idempotent only. Metadata only: never message text.

-- 1. The raw history of every deal, append-only (history cannot be rebuilt later; the platform keeps only the last stage and status change time).
--    One row per fact, idempotent by event_key (a repeated webhook, a retry, an overlapping sweep or the sync all write the same key).
--    actor_kind: 'person' (a team member), 'automation' (a workflow), 'subsync' (our own write, excluded from our metrics), 'system', 'unknown'.
--    from_value / to_value hold stage ids for stage events, a status for status events, numbers as text for value events, user ids for owner events.
create table if not exists public.deal_history (
  id bigint generated always as identity primary key,
  installation_id uuid not null,
  location_id text not null,
  opportunity_id text not null,
  contact_id text,
  pipeline_id text,
  kind text not null check (kind in ('created', 'stage', 'status', 'value', 'owner', 'lost_reason', 'source', 'appointment_linked', 'deleted', 'note')),
  event_key text not null,
  from_value text,
  to_value text,
  from_name text,
  to_name text,
  value numeric,
  dwell_seconds integer,
  actor_id text,
  actor_kind text not null default 'unknown' check (actor_kind in ('person', 'automation', 'subsync', 'system', 'unknown')),
  at timestamptz not null,
  detail jsonb not null default '{}'::jsonb,
  recorded_at timestamptz not null default now(),
  unique (installation_id, location_id, event_key)
);
create index if not exists deal_history_opp_idx on public.deal_history (installation_id, location_id, opportunity_id, at);
create index if not exists deal_history_time_idx on public.deal_history (installation_id, kind, at desc);
create index if not exists deal_history_loc_time_idx on public.deal_history (installation_id, location_id, kind, at desc);
alter table public.deal_history enable row level security;
revoke all on public.deal_history from anon, authenticated;

create or replace function public.deal_history_append_only() returns trigger language plpgsql as $$
begin
  raise exception 'deal_history is append-only';
end;
$$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'deal_history_no_update' and tgrelid = 'public.deal_history'::regclass) then
    create trigger deal_history_no_update before update on public.deal_history
      for each row execute function public.deal_history_append_only();
  end if;
end $$;

-- 2. One row per deal of facts we keep ourselves: the lost reason, the appointment it came from, and a marker when the deal was removed in the CRM.
create table if not exists public.deal_facts (
  installation_id uuid not null,
  location_id text not null,
  opportunity_id text not null,
  lost_reason_id text,
  lost_reason text,
  booked_from_appointment text,
  removed_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (installation_id, location_id, opportunity_id)
);
alter table public.deal_facts enable row level security;
revoke all on public.deal_facts from anon, authenticated;

-- 3. Per-stage dwell, from the account's own history (refreshed hourly by the sweep). limit_days is the stale limit for that stage:
--    the 75th percentile of completed stays (floor 3, cap 60 days) when there are at least 20, else an estimate from the won cycle.
create table if not exists public.deal_stage_stats (
  installation_id uuid not null,
  location_id text not null,
  stage_id text not null,
  stays integer not null default 0,
  median_days numeric,
  p75_days numeric,
  p90_days numeric,
  limit_days numeric not null,
  is_estimate boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (installation_id, location_id, stage_id)
);
alter table public.deal_stage_stats enable row level security;
revoke all on public.deal_stage_stats from anon, authenticated;

-- 4. Forecast track record: one row per account per day (the range we said); compared with what was won in the next 30 days.
create table if not exists public.deal_forecast_log (
  installation_id uuid not null,
  location_id text not null,
  day date not null,
  low numeric not null,
  mid numeric not null,
  high numeric not null,
  open_value numeric not null default 0,
  open_count integer not null default 0,
  primary key (installation_id, location_id, day)
);
alter table public.deal_forecast_log enable row level security;
revoke all on public.deal_forecast_log from anon, authenticated;

-- 5. Where recording began for an installation, so the backfill from the older deal_events copies only what came before (no double counting).
create table if not exists public.deal_record_state (
  installation_id uuid primary key,
  since timestamptz not null default now(),
  backfilled_at timestamptz
);
alter table public.deal_record_state enable row level security;
revoke all on public.deal_record_state from anon, authenticated;

-- 6. Indexes the aggregates need at millions of rows.
create index if not exists cached_opportunities_status_changed_idx on public.cached_opportunities (installation_id, location_id, status, last_status_change_at);
create index if not exists cached_opportunities_stage_idx on public.cached_opportunities (installation_id, location_id, stage_id, status);
create index if not exists cached_opportunities_owner_idx on public.cached_opportunities (installation_id, location_id, assigned_to, status);
create index if not exists cached_appointments_contact_start_idx on public.cached_appointments (installation_id, location_id, contact_id, start_at desc);
