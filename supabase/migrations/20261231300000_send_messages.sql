-- Sending texts and emails from SubSync (King, 13 Nov 2026). Additive only; the feature is behind the send_messages flag, default off.
-- message_sends: one row per send attempt. Ids, the channel, a one-way hash of the words and the result. NEVER the words themselves.
--   It is the record behind the daily limits, the duplicate check and the "our own sends do not count" rule.
-- message_templates: the account's own quick templates (its own words with merge fields such as {first_name}), never a customer's message.
-- message_send_settings: the account's own sending rules (pause, quiet hours, limits, opt-out line).
do $$ begin
  create table if not exists public.message_sends (
    id uuid primary key default gen_random_uuid(),
    installation_id uuid not null references public.installations (id) on delete cascade,
    location_id text not null,
    contact_id text not null,
    channel text not null check (channel in ('SMS', 'Email')),
    actor text,
    actor_name text,
    text_hash text not null,
    segments integer not null default 0,
    result text not null,
    dry_run boolean not null default false,
    idem_key text not null,
    ghl_message_id text,
    created_at timestamptz not null default now(),
    unique (installation_id, idem_key)
  );
  create index if not exists message_sends_contact_idx on public.message_sends (installation_id, location_id, contact_id, created_at desc);
  create index if not exists message_sends_account_idx on public.message_sends (installation_id, location_id, created_at desc);
  alter table public.message_sends enable row level security;
  revoke all on public.message_sends from anon, authenticated;

  create table if not exists public.message_templates (
    id uuid primary key default gen_random_uuid(),
    installation_id uuid not null references public.installations (id) on delete cascade,
    location_id text not null,
    name text not null,
    channel text not null check (channel in ('SMS', 'Email')),
    subject text,
    body text not null,
    created_by text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );
  create index if not exists message_templates_account_idx on public.message_templates (installation_id, location_id);
  alter table public.message_templates enable row level security;
  revoke all on public.message_templates from anon, authenticated;

  create table if not exists public.message_send_settings (
    installation_id uuid not null references public.installations (id) on delete cascade,
    location_id text not null,
    paused boolean not null default false,
    quiet_start_hour integer not null default 21 check (quiet_start_hour between 0 and 23),
    quiet_end_hour integer not null default 8 check (quiet_end_hour between 0 and 23),
    per_person_hour integer not null default 2 check (per_person_hour between 1 and 20),
    per_person_day integer not null default 5 check (per_person_day between 1 and 50),
    account_day integer not null default 200 check (account_day between 1 and 5000),
    dup_minutes integer not null default 10 check (dup_minutes between 1 and 1440),
    footer_enabled boolean not null default false,
    footer_text text not null default 'Reply STOP to opt out.',
    link_allowlist text not null default '',
    allow_agency_send boolean not null default true,
    updated_by text,
    updated_at timestamptz not null default now(),
    primary key (installation_id, location_id)
  );
  alter table public.message_send_settings enable row level security;
  revoke all on public.message_send_settings from anon, authenticated;
end $$;
