-- Schema for the Phase 1-3 features: richer location data, pipelines, conversations,
-- daily metric history, alerts, domain checks and webhook de-duplication.
-- All new tables have RLS on with no policies; access is server-side only.

alter table public.installations
  add column if not exists is_demo boolean not null default false;

alter table public.locations
  add column if not exists website text,
  add column if not exists address text,
  add column if not exists installed_at timestamptz,
  add column if not exists calendar_count integer,
  add column if not exists pipeline_count integer,
  add column if not exists sync_error text,
  add column if not exists structure_synced_at timestamptz,
  add column if not exists contacts_synced_at timestamptz,
  add column if not exists opportunities_synced_at timestamptz,
  add column if not exists conversations_synced_at timestamptz;

alter table public.cached_contacts
  add column if not exists updated_remote_at timestamptz;

alter table public.cached_opportunities
  add column if not exists last_action_at timestamptz,
  add column if not exists created_remote_at timestamptz,
  add column if not exists updated_remote_at timestamptz;

alter table public.settings
  add column if not exists sla_hours integer not null default 4,
  add column if not exists dormant_days integer not null default 30,
  add column if not exists slack_webhook_url text,
  add column if not exists ghl_app_domain text not null default 'app.gohighlevel.com',
  add column if not exists digest_enabled boolean not null default false;

-- Sync job types
alter table public.sync_jobs drop constraint if exists sync_jobs_type_check;
alter table public.sync_jobs add constraint sync_jobs_type_check
  check (type in ('locations', 'structure', 'contacts', 'opportunities', 'conversations', 'metrics'));
create unique index if not exists sync_jobs_active_unique
  on public.sync_jobs (installation_id, coalesce(location_id, ''), type)
  where status in ('pending', 'running');

-- Pipelines (names for stages)
create table public.pipelines (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null references public.installations (id) on delete cascade,
  location_id text not null,
  pipeline_id text not null,
  name text,
  stages jsonb not null default '[]',
  synced_at timestamptz not null default now(),
  unique (installation_id, location_id, pipeline_id)
);

-- Conversation summaries (no message bodies are stored)
create table public.cached_conversations (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null references public.installations (id) on delete cascade,
  location_id text not null,
  conversation_id text not null,
  contact_id text,
  contact_name text,
  last_message_type text,
  last_message_direction text,
  last_message_at timestamptz,
  unread_count integer not null default 0,
  synced_at timestamptz not null default now(),
  unique (installation_id, location_id, conversation_id)
);
create index cached_conversations_unread_idx
  on public.cached_conversations (installation_id, location_id) where unread_count > 0;
create index cached_conversations_last_idx
  on public.cached_conversations (installation_id, last_message_at);

-- One row per account per day, for trends and churn detection
create table public.account_metrics_daily (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null references public.installations (id) on delete cascade,
  location_id text not null,
  day date not null,
  contacts integer not null default 0,
  new_contacts_30d integer not null default 0,
  open_opportunities integer not null default 0,
  open_value numeric not null default 0,
  stale_opportunities integer not null default 0,
  unread_conversations integer not null default 0,
  completeness_pct integer not null default 0,
  engagement_score integer not null default 0,
  days_inactive integer,
  unique (installation_id, location_id, day)
);

-- In-app alert feed (optionally pushed to Slack)
create table public.alerts (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null references public.installations (id) on delete cascade,
  location_id text,
  kind text not null,
  severity text not null check (severity in ('info', 'warning', 'critical')),
  title text not null,
  detail jsonb not null default '{}',
  dedupe_key text not null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  notified_at timestamptz
);
create unique index alerts_open_dedupe
  on public.alerts (installation_id, dedupe_key) where resolved_at is null;
create index alerts_feed_idx on public.alerts (installation_id, created_at desc);

-- Email authentication results per sending domain
create table public.domain_checks (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null references public.installations (id) on delete cascade,
  location_id text,
  domain text not null,
  status text not null check (status in ('ok', 'warning', 'critical', 'error')),
  result jsonb not null default '{}',
  checked_at timestamptz not null default now(),
  unique (installation_id, domain)
);

-- Webhook de-duplication (the platform retries failed deliveries up to 12 times)
create table public.webhook_events (
  webhook_id text primary key,
  event_type text,
  received_at timestamptz not null default now()
);
create index webhook_events_received_idx on public.webhook_events (received_at);

-- Indexes used by the analytics queries
create index cached_contacts_activity_idx
  on public.cached_contacts (installation_id, location_id, last_activity_at);
create index cached_contacts_added_idx
  on public.cached_contacts (installation_id, location_id, date_added);
create index cached_contacts_dupe_email_idx
  on public.cached_contacts (installation_id, location_id, lower(email))
  where email is not null and email <> '';
create index cached_contacts_dupe_phone_idx
  on public.cached_contacts (installation_id, location_id, phone_digits)
  where length(phone_digits) >= 7;
create index cached_opps_status_idx
  on public.cached_opportunities (installation_id, location_id, status);

alter table public.pipelines enable row level security;
alter table public.cached_conversations enable row level security;
alter table public.account_metrics_daily enable row level security;
alter table public.alerts enable row level security;
alter table public.domain_checks enable row level security;
alter table public.webhook_events enable row level security;

revoke all on public.pipelines from anon, authenticated;
revoke all on public.cached_conversations from anon, authenticated;
revoke all on public.account_metrics_daily from anon, authenticated;
revoke all on public.alerts from anon, authenticated;
revoke all on public.domain_checks from anon, authenticated;
revoke all on public.webhook_events from anon, authenticated;
