-- Additive (Speed to lead, stage SPEED4): one row per message or call EVENT, metadata only. NEVER the text of a message.
-- Feeds missed calls with no follow-up, the missed-call text-back audit, best time to reach, channel mix and delivery health.
-- Idempotent: the same event twice (a webhook retry, a re-read of a conversation) writes one row (unique event_key).
create table if not exists public.touch_events (
  id bigint generated always as identity primary key,
  installation_id uuid not null references public.installations (id) on delete cascade,
  location_id text not null,
  contact_id text not null,
  conversation_id text,
  event_key text not null,
  direction text not null check (direction in ('inbound', 'outbound')),
  channel text not null check (channel in ('sms', 'email', 'whatsapp', 'call', 'chat', 'other')),
  kind text not null check (kind in ('message', 'call', 'missed_call', 'failed')),
  at timestamptz not null,
  user_id text,
  automated boolean not null default false,
  source text,
  created_at timestamptz not null default now(),
  unique (installation_id, location_id, event_key)
);
create index if not exists touch_events_contact_idx on public.touch_events (installation_id, location_id, contact_id, at);
create index if not exists touch_events_time_idx on public.touch_events (installation_id, at desc);
alter table public.touch_events enable row level security;

-- Outcome of a message or call as the platform reports it (delivered, failed, no-answer...), a word, never content.
alter table public.touch_events add column if not exists outcome text;
alter table public.touch_events add column if not exists campaign text;

-- Lifecycle events SubSync records itself (the platform keeps no history). Stage and status changes of deals live in deal_events, tag changes in
-- contact_tag_events, appointment changes in appointment_events (reused, not copied); this table adds what was missing: a lead arriving,
-- its first person touch, and an owner change. Idempotent by event_key. Metadata only.
create table if not exists public.lead_events (
  id bigint generated always as identity primary key,
  installation_id uuid not null references public.installations (id) on delete cascade,
  location_id text not null,
  contact_id text not null,
  kind text not null check (kind in ('created', 'first_touch', 'owner_changed', 'stage_changed', 'tag_added', 'tag_removed')),
  event_key text not null,
  from_value text,
  to_value text,
  user_id text,
  at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (installation_id, location_id, event_key)
);
create index if not exists lead_events_contact_idx on public.lead_events (installation_id, location_id, contact_id, at);
create index if not exists lead_events_time_idx on public.lead_events (installation_id, at desc);
alter table public.lead_events enable row level security;

-- One row per account per day, rebuilt by the nightly job from the records above: the answer for long ranges and many accounts without reading every lead.
create table if not exists public.speed_daily (
  installation_id uuid not null references public.installations (id) on delete cascade,
  location_id text not null,
  day date not null,
  leads integer not null default 0,
  answered integer not null default 0,
  within_target integer not null default 0,
  median_seconds integer,
  buckets jsonb not null default '{}'::jsonb,      -- response time buckets: counts
  by_channel jsonb not null default '{}'::jsonb,   -- outbound person touches per channel
  by_source jsonb not null default '{}'::jsonb,    -- leads per source
  by_owner jsonb not null default '{}'::jsonb,     -- leads per owner id
  by_hour jsonb not null default '[]'::jsonb,      -- 24 numbers: leads per local hour
  missed_calls integer not null default 0,
  missed_followed integer not null default 0,
  texted_back_60 integer not null default 0,
  failed_sends integer not null default 0,
  rebuilt_at timestamptz not null default now(),
  primary key (installation_id, location_id, day)
);
create index if not exists speed_daily_day_idx on public.speed_daily (installation_id, day desc);
alter table public.speed_daily enable row level security;

-- Message text is never stored. A per-account opt-in to keep it is reserved here and stays OFF; nothing reads it yet.
alter table public.settings add column if not exists speed_keep_message_text boolean not null default false;
