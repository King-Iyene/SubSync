create table if not exists public.unanswered_outcomes (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null references public.installations (id) on delete cascade,
  location_id text not null,
  conversation_id text not null,
  contact_id text,
  outcome text not null check (outcome in ('replied', 'appointment_booked', 'not_a_lead', 'needs_follow_up')),
  recorded_by text not null,
  created_at timestamptz not null default now()
);

create index if not exists unanswered_outcomes_feed_idx
  on public.unanswered_outcomes (installation_id, location_id, created_at desc);
create index if not exists unanswered_outcomes_conversation_idx
  on public.unanswered_outcomes (installation_id, location_id, conversation_id, created_at desc);

alter table public.settings
  add column if not exists inbox_ack_grace_minutes integer not null default 120
  check (inbox_ack_grace_minutes between 15 and 720);

alter table public.unanswered_outcomes enable row level security;
revoke all on public.unanswered_outcomes from anon, authenticated;
