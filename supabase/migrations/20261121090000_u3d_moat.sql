-- Unanswered round 3, slice D/E (moat and proof). Additive and idempotent only. Metadata only: never the text of a message.

-- D1. The raw record of what happened to each lead, append-only, because history cannot be rebuilt later. One row per fact.
-- Idempotent by event_key (the same fact twice writes one row). A row is never changed: an update raises an error.
create table if not exists public.moat_events (
  id bigint generated always as identity primary key,
  installation_id uuid not null references public.installations (id) on delete cascade,
  location_id text not null,
  contact_id text,
  conversation_id text,
  kind text not null check (kind in (
    'lead_created', 'first_human_touch', 'first_auto_touch', 'owner_changed', 'alert_fired', 'alert_outcome', 'alert_feedback',
    'appointment_booked', 'appointment_showed', 'appointment_no_show', 'deal_won', 'deal_lost', 'reply_target_set'
  )),
  event_key text not null,
  at timestamptz not null,
  channel text,
  user_id text,
  automated boolean,
  owner_id text,
  value numeric,
  target_minutes integer,
  vertical text,
  detail jsonb not null default '{}'::jsonb,
  recorded_at timestamptz not null default now(),
  unique (installation_id, location_id, event_key)
);
create index if not exists moat_events_loc_kind_idx on public.moat_events (installation_id, location_id, kind, at desc);
create index if not exists moat_events_contact_idx on public.moat_events (installation_id, location_id, contact_id, at);
alter table public.moat_events enable row level security;
revoke all on public.moat_events from anon, authenticated;

create or replace function public.moat_events_append_only() returns trigger language plpgsql as $$
begin
  raise exception 'moat_events is append-only';
end;
$$;
drop trigger if exists moat_events_no_update on public.moat_events;
create trigger moat_events_no_update before update on public.moat_events
  for each row execute function public.moat_events_append_only();

-- D1. The kind of business each client account is (optional, set by the agency). Used for benchmarks only when the agency opts in.
alter table public.account_profiles add column if not exists vertical text;
alter table public.account_profiles drop constraint if exists account_profiles_vertical_check;
alter table public.account_profiles add constraint account_profiles_vertical_check
  check (vertical is null or vertical in ('med_spa', 'solar', 'home_services', 'real_estate', 'legal', 'coaching', 'other'));

-- D5. Opt-in to the anonymous peer benchmark (off by default). Opting in lets this agency's accounts count toward, and see, the benchmark.
alter table public.settings add column if not exists benchmark_opt_in boolean not null default false;

-- D6. A shareable reply-time page. The snapshot is stored with a hash of its content and a link to the previous page's hash
-- (a chain per installation), so a page that was edited afterwards no longer matches. The owner can switch a link off.
create table if not exists public.reply_proof_pages (
  id text primary key,
  installation_id uuid not null references public.installations (id) on delete cascade,
  location_id text not null,
  seq integer not null,
  payload jsonb not null,
  payload_hash text not null,
  prev_hash text not null,
  chain_hash text not null,
  signature text,
  created_by text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 days'),
  revoked_at timestamptz,
  views integer not null default 0,
  last_viewed_at timestamptz,
  unique (installation_id, seq)
);
create index if not exists reply_proof_pages_loc_idx on public.reply_proof_pages (installation_id, location_id, created_at desc);
alter table public.reply_proof_pages enable row level security;
revoke all on public.reply_proof_pages from anon, authenticated;
