-- Daily rollups are keyed by the account's LOCAL day (its own zone, else Africa/Lagos), not the UTC day (docs/DATE_RULES.md). Additive only.
-- `tz` records the zone a row's day was keyed in; null means a legacy UTC-keyed row. A UTC-day row cannot be turned into a local day exactly (one UTC day spans two
-- local days), so nothing is guessed: the next sweep replaces the whole window (client_daily 120 days, pm_rollup_daily 90 days, speed_daily 35 days, pipeline_rollup
-- closed_day), and until then the Clients and Pipeline screens use their live scan.
alter table public.client_daily add column if not exists tz text;
alter table public.pm_rollup_daily add column if not exists tz text;
update public.client_rollup_state set refreshed_at = timestamptz 'epoch';
update public.pipeline_rollup_state set refreshed_at = timestamptz 'epoch';
