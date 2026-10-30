-- Additive: industry reply targets (a setting), and the meeting notes inbox.
-- Nothing here changes or removes existing data.

alter table public.settings add column if not exists industry_targets boolean not null default false;

-- A private address a meeting tool (Fathom, Zoom through an automation) posts to. Only a hash of the
-- secret part is stored, so the address can be shown once and never read back.
create table if not exists public.meeting_hooks (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null references public.installations (id) on delete cascade,
  location_id text not null,
  token_hash text not null unique,
  label text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
create index if not exists meeting_hooks_installation_idx on public.meeting_hooks (installation_id);

-- What a meeting tool sent. The transcript is only kept when the account switched that on.
create table if not exists public.meeting_notes (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null references public.installations (id) on delete cascade,
  location_id text not null,
  source text not null default 'other',
  title text,
  started_at timestamptz,
  attendees jsonb not null default '[]',
  summary text,
  action_items jsonb not null default '[]',
  transcript text,
  recording_url text,
  contact_id text,
  status text not null default 'new' check (status in ('new', 'filed', 'dismissed')),
  received_at timestamptz not null default now()
);
create index if not exists meeting_notes_installation_idx on public.meeting_notes (installation_id, location_id, received_at desc);

alter table public.settings add column if not exists keep_transcripts boolean not null default false;

alter table public.meeting_hooks enable row level security;
alter table public.meeting_notes enable row level security;
