-- Additive: Workflows second pass. One row per client account per day with the outcome counts that show whether lead-handling automations are working
-- (counts only, never a person or a message). Written once a day by the workflow sweep, idempotent on (installation, account, day), kept as our own history.
-- Safe to run twice.
create table if not exists public.wf_outcome_daily (
  installation_id uuid not null references public.installations (id) on delete cascade,
  location_id text not null,
  day date not null,
  new_leads integer not null default 0,
  no_touch integer not null default 0,
  missed_calls integer not null default 0,
  no_textback integer not null default 0,
  noshows integer not null default 0,
  noshow_open integer not null default 0,
  upcoming integer not null default 0,
  no_reminder integer not null default 0,
  at_risk_value numeric not null default 0,
  primary key (installation_id, location_id, day)
);
create index if not exists wf_outcome_daily_day_idx on public.wf_outcome_daily (installation_id, day desc);
alter table public.wf_outcome_daily enable row level security;
