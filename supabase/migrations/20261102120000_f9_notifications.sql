-- Stage F9 (alerts, Slack, in-app notifications, email). Additive and idempotent: five NEW tables, nothing existing is changed.
-- Row level security is on for every table and NO policy is created, so the public (anon) and signed-in (authenticated) database roles read and
-- write nothing. Only server code, which connects with the database owner role, can use them. The same roles also lose their table privileges.
--
--   notification_prefs         what each company chose for each kind of message: channels, recipients, time, quiet hours, wording
--   notification_destinations  Slack channels (one row per channel a person authorised); the channel address is encrypted by the app
--   notifications              the in-app notification centre (the bell): one row per item, the words a person reads
--   notification_states        who has read, dismissed or snoozed which item (per signed-in person)
--   notification_deliveries    the dispatcher's ledger: one row per message to one place, so nothing is sent twice and a failed send is retried

create table if not exists public.notification_prefs (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null references public.installations (id) on delete cascade,
  type text not null,
  enabled boolean not null default true,
  channels jsonb not null default '{}',
  recipients jsonb not null default '[]',
  timing jsonb not null default '{}',
  copy jsonb not null default '{}',
  updated_by text,
  updated_at timestamptz not null default now()
);
create unique index if not exists notification_prefs_type_idx on public.notification_prefs (installation_id, type);

create table if not exists public.notification_destinations (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null references public.installations (id) on delete cascade,
  provider text not null default 'slack',
  label text,
  -- Empty means the whole company (cross-account messages). A client account id means ONLY that account's messages, so one client's Slack never
  -- receives another client's data.
  location_id text,
  webhook_url_enc text,
  status text not null default 'pending',
  pending_since timestamptz,
  last_ok_at timestamptz,
  last_error_code text,
  connected_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists notification_destinations_installation_idx on public.notification_destinations (installation_id);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null references public.installations (id) on delete cascade,
  location_id text,
  type text not null,
  severity text not null default 'info',
  title text not null,
  body text,
  link jsonb not null default '{}',
  alert_id uuid,
  dedupe_key text,
  created_at timestamptz not null default now()
);
create unique index if not exists notifications_dedupe_idx on public.notifications (installation_id, dedupe_key) where dedupe_key is not null;
create index if not exists notifications_recent_idx on public.notifications (installation_id, created_at desc);

create table if not exists public.notification_states (
  notification_id uuid not null,
  user_key text not null,
  installation_id uuid not null references public.installations (id) on delete cascade,
  location_id text,
  read_at timestamptz,
  dismissed_at timestamptz,
  snoozed_until timestamptz,
  updated_at timestamptz not null default now(),
  primary key (notification_id, user_key)
);
create index if not exists notification_states_installation_idx on public.notification_states (installation_id);

create table if not exists public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null references public.installations (id) on delete cascade,
  location_id text,
  type text not null,
  channel text not null,
  target text not null,
  dedupe_key text not null,
  severity text not null default 'info',
  status text not null default 'pending',
  reason text,
  payload jsonb not null default '{}',
  alert_id uuid,
  attempts integer not null default 0,
  next_attempt_at timestamptz,
  last_error_code text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create unique index if not exists notification_deliveries_once_idx on public.notification_deliveries (installation_id, dedupe_key, channel, target);
create index if not exists notification_deliveries_work_idx on public.notification_deliveries (installation_id, status, next_attempt_at);

alter table public.notification_prefs enable row level security;
alter table public.notification_destinations enable row level security;
alter table public.notifications enable row level security;
alter table public.notification_states enable row level security;
alter table public.notification_deliveries enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on table public.notification_prefs, public.notification_destinations, public.notifications, public.notification_states, public.notification_deliveries from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on table public.notification_prefs, public.notification_destinations, public.notifications, public.notification_states, public.notification_deliveries from authenticated;
  end if;
end $$;
