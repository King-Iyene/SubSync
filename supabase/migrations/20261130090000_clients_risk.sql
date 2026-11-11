-- Clients module, slice CB (churn-risk history). Additive and idempotent. Not applied automatically.
-- client_risk_history: one row per client per day with the risk level SubSync estimated and the points behind it. Our own record, so a later screen can show whether a client got better
-- or worse. Counts and a level only; never a name or a message.
create table if not exists public.client_risk_history (
  installation_id uuid not null references public.installations (id) on delete cascade,
  location_id text not null,
  day date not null,
  level text not null check (level in ('high', 'watch', 'steady', 'not_enough_data')),
  points integer not null default 0,
  history_days integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (installation_id, location_id, day)
);
alter table public.client_risk_history enable row level security;
revoke all on public.client_risk_history from anon, authenticated;
