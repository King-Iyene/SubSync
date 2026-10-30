-- Additive: sign-in connections to Slack, Fathom and Zoom, and a reference on each saved meeting note so
-- the same meeting sent twice is only kept once. Nothing here changes or removes existing data.

create table if not exists public.connections (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null references public.installations (id) on delete cascade,
  provider text not null check (provider in ('slack', 'fathom', 'zoom')),
  status text not null default 'connected' check (status in ('connected', 'needs_reconnect')),
  -- What the person sees: the Slack workspace and channel, or the Zoom email.
  label text,
  -- Zoom: the person who signed in. Fathom: the webhook SubSync registered.
  external_id text,
  -- Tokens are encrypted before they are stored (same key as the platform tokens). Slack stores none:
  -- the channel address it hands back goes into the install's settings instead.
  access_token_enc text,
  refresh_token_enc text,
  token_expires_at timestamptz,
  -- Fathom: the secret its webhooks are signed with, and the random part of the address it posts to.
  webhook_secret_enc text,
  public_key text unique,
  -- A single business is limited to its own account. For an agency, the account that notes go to
  -- when nobody in the meeting is a known contact (empty means: do not save those).
  only_location_id text,
  default_location_id text,
  saved_count integer not null default 0,
  skipped_count integer not null default 0,
  connected_by text,
  last_event_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists connections_installation_idx on public.connections (installation_id);
create unique index if not exists connections_one_slack_fathom_idx on public.connections (installation_id, provider) where provider in ('slack', 'fathom');
create unique index if not exists connections_zoom_person_idx on public.connections (installation_id, external_id) where provider = 'zoom';
create index if not exists connections_zoom_host_idx on public.connections (external_id) where provider = 'zoom';
alter table public.connections enable row level security;

alter table public.meeting_notes add column if not exists external_id text;
create unique index if not exists meeting_notes_external_idx on public.meeting_notes (installation_id, source, external_id) where external_id is not null;
