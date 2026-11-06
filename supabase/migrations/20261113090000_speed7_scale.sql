-- Additive (Speed to lead, stage SPEED7: scale). NOT applied by the build: run it when you are ready (it only adds indexes and columns, nothing is changed or removed).
-- Why: Speed to lead now counts with SQL aggregates (one grouped query per card). These indexes keep each of those reads an index range scan for an agency with 80+ client accounts
-- and 100,000+ leads per account, and the extra rollup columns let long date ranges be answered from speed_daily instead of from the leads.

-- A window of leads across every account of one company (the agency view) with no location in the filter.
create index if not exists lead_touches_agency_idx on public.lead_touches (installation_id, lead_at desc) where excluded is null;
-- Waiting leads (nobody touched them) are the hot path of every list and card.
create index if not exists lead_touches_waiting_idx on public.lead_touches (installation_id, location_id, lead_at desc) where excluded is null and touch_at is null;
-- A person's replies (people tables, who-replies-fastest).
create index if not exists lead_touches_user_idx on public.lead_touches (installation_id, touch_user_id, lead_at desc) where touch_user_id is not null;

-- Events by account and time (missed calls, best time to reach, channel mix, replies after a first touch).
create index if not exists touch_events_loc_time_idx on public.touch_events (installation_id, location_id, at desc);
create index if not exists touch_events_inbound_idx on public.touch_events (installation_id, at desc) where direction = 'inbound';
create index if not exists lead_events_loc_kind_idx on public.lead_events (installation_id, location_id, kind, at desc);

-- What became of a lead (booked, showed, won): per contact, newest start first.
create index if not exists cached_appointments_contact_start_idx on public.cached_appointments (installation_id, location_id, contact_id, start_at desc);
create index if not exists cached_opportunities_contact_status_idx on public.cached_opportunities (installation_id, location_id, contact_id, status);

-- Rollup columns: one row per account per day already holds leads, answered, within target and the buckets. These add the rest of what a long range needs.
alter table public.speed_daily add column if not exists late integer not null default 0;
alter table public.speed_daily add column if not exists waiting integer not null default 0;
alter table public.speed_daily add column if not exists no_owner integer not null default 0;
alter table public.speed_daily add column if not exists p90_seconds integer;
alter table public.speed_daily add column if not exists auto_only integer not null default 0;
alter table public.speed_daily add column if not exists by_user jsonb not null default '{}'::jsonb;   -- replies and typical first reply per person
create index if not exists speed_daily_loc_day_idx on public.speed_daily (installation_id, location_id, day desc);
