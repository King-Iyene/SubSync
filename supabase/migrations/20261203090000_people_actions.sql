-- People (Team) module, slice PB (actions, coaching, proof). Additive and idempotent. Not applied automatically (King approves the production apply).
-- Everything here is SubSync's own record about the people on a team; none of it is a CRM field. No message words are ever stored: notes are written by a manager about work habits,
-- the write log holds ids only. Every table: installation_id first in every key and index, RLS on, no access for the browser roles.

-- Coaching notes about one person. Private to the author and to administrators; a note may be marked "shared with them" so the person sees it too.
-- `removed_at` is a soft mark so a note can be put back for a short time; it is only ever set after the person typed the note's title.
create table if not exists public.coaching_notes (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null references public.installations (id) on delete cascade,
  subject_user_id text not null,
  location_id text,
  title text not null check (char_length(title) between 1 and 60),
  body text not null check (char_length(body) between 1 and 2000),
  shared_with_subject boolean not null default false,
  author_user_id text,
  author_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  removed_at timestamptz
);
create index if not exists coaching_notes_subject_idx on public.coaching_notes (installation_id, subject_user_id, created_at desc) where removed_at is null;
alter table public.coaching_notes enable row level security;
revoke all on public.coaching_notes from anon, authenticated;

-- Targets per person. location_id '' means "all of this person's accounts". For the reply minutes the account's own reply target is the default until one is set here.
create table if not exists public.user_targets (
  installation_id uuid not null references public.installations (id) on delete cascade,
  user_id text not null,
  location_id text not null default '',
  metric text not null check (metric in ('reply_minutes', 'in_time_share', 'appointments_week', 'show_share', 'won_value_month')),
  target numeric not null check (target >= 0 and target <= 100000000),
  set_by text,
  updated_at timestamptz not null default now(),
  primary key (installation_id, user_id, location_id, metric)
);
alter table public.user_targets enable row level security;
revoke all on public.user_targets from anon, authenticated;

-- "Away" marks (holiday, sick, training) and snoozes of one person's idle alert. Both end on a date and can be ended early (released_at). A person who is away is left out of
-- idle and overload alerts and of the next-lead suggestion; the mark never changes any number that was recorded.
create table if not exists public.user_away (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null references public.installations (id) on delete cascade,
  user_id text not null,
  kind text not null check (kind in ('away', 'idle_snooze')),
  reason text check (reason in ('holiday', 'sick', 'training', 'other')),
  starts_at timestamptz not null default now(),
  until timestamptz not null,
  set_by text,
  created_at timestamptz not null default now(),
  released_at timestamptz,
  check (until > starts_at)
);
create index if not exists user_away_open_idx on public.user_away (installation_id, user_id, until) where released_at is null;
alter table public.user_away enable row level security;
revoke all on public.user_away from anon, authenticated;

-- One row per lead moved to another owner from SubSync (and per put-back). Ids only. `before_owner` lets a recent change be put back; the rows whose result is 'done' are
-- SubSync's own writes, so owner history and every activity figure can recognise and skip them (principle 14).
create table if not exists public.people_write_log (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null references public.installations (id) on delete cascade,
  location_id text not null,
  batch_id uuid not null,
  action text not null check (action in ('reassign', 'undo')),
  contact_id text not null,
  before_owner text,
  after_owner text,
  suggested boolean not null default false,
  result text not null,
  actor text,
  created_at timestamptz not null default now()
);
create index if not exists people_write_log_batch_idx on public.people_write_log (installation_id, batch_id);
create index if not exists people_write_log_contact_idx on public.people_write_log (installation_id, location_id, contact_id, created_at desc);
alter table public.people_write_log enable row level security;
revoke all on public.people_write_log from anon, authenticated;

-- Per client choice for the proof receipt: name the staff, or keep it at team level (the default).
create table if not exists public.people_proof_prefs (
  installation_id uuid not null references public.installations (id) on delete cascade,
  location_id text not null,
  name_staff boolean not null default false,
  updated_by text,
  updated_at timestamptz not null default now(),
  primary key (installation_id, location_id)
);
alter table public.people_proof_prefs enable row level security;
revoke all on public.people_proof_prefs from anon, authenticated;
