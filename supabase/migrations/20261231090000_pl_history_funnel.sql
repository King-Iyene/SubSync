-- Pipeline history funnel and stuck-in-stage list (flag pl_history_funnel). Additive and idempotent only.
-- The funnel and the stuck list read the append-only deal_history and deal_stage_stats that already exist; this adds only the person's own choices.
create table if not exists public.pl_history_settings (
  installation_id uuid primary key,
  -- The fewest past stays (or deals that entered a step) a number needs before we show it. Below this the screen says "Not enough data yet".
  min_sample integer not null default 10 check (min_sample between 5 and 100),
  -- Leave deals that look like tests out of the funnel and the stuck list.
  exclude_test boolean not null default true,
  -- The pipeline the funnel opens on (by name, so it works across client accounts). Empty means the one with the most deals.
  default_pipeline text check (default_pipeline is null or char_length(default_pipeline) <= 120),
  updated_at timestamptz not null default now()
);
alter table public.pl_history_settings enable row level security;
revoke all on public.pl_history_settings from anon, authenticated;
