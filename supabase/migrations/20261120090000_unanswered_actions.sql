-- Unanswered round 3, slice B (actions). Additive and idempotent. Not applied automatically.
-- 1. Snoozes: SubSync's own "handled / later" mark on a waiting conversation. No CRM write. Reversible (released_at). No message text.
create table if not exists public.unanswered_snoozes (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null references public.installations (id) on delete cascade,
  location_id text not null,
  conversation_id text not null,
  contact_id text,
  reason text not null check (reason in ('waiting_on_customer', 'call_back_later', 'handled_elsewhere', 'not_a_real_lead', 'other')),
  until_at timestamptz not null,
  created_by text not null,
  created_at timestamptz not null default now(),
  released_at timestamptz,
  released_by text
);
create index if not exists unanswered_snoozes_active_idx
  on public.unanswered_snoozes (installation_id, location_id, conversation_id) where released_at is null;
create index if not exists unanswered_snoozes_until_idx
  on public.unanswered_snoozes (installation_id, until_at) where released_at is null;
alter table public.unanswered_snoozes enable row level security;
revoke all on public.unanswered_snoozes from anon, authenticated;

-- 2. Action log: one row per item of a claim, assign, junk clear or note, with the before value so an assignment can be put back. Ids and owner ids only, never a message or a name.
create table if not exists public.unanswered_actions (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null references public.installations (id) on delete cascade,
  location_id text not null,
  batch_id uuid not null,
  action text not null check (action in ('claim', 'assign', 'clear_junk', 'note', 'undo_assign')),
  conversation_id text,
  contact_id text,
  before_owner text,
  after_owner text,
  result text not null,
  actor text,
  created_at timestamptz not null default now()
);
create index if not exists unanswered_actions_batch_idx on public.unanswered_actions (installation_id, batch_id);
create index if not exists unanswered_actions_feed_idx on public.unanswered_actions (installation_id, location_id, created_at desc);
alter table public.unanswered_actions enable row level security;
revoke all on public.unanswered_actions from anon, authenticated;

-- 3. What is hidden from the waiting list by default (one row per installation; no row means the defaults, all on).
create table if not exists public.unanswered_hide_settings (
  installation_id uuid primary key references public.installations (id) on delete cascade,
  hide_not_a_lead boolean not null default true,
  hide_internal boolean not null default true,
  hide_automatic boolean not null default true,
  updated_by text,
  updated_at timestamptz not null default now()
);
alter table public.unanswered_hide_settings enable row level security;
revoke all on public.unanswered_hide_settings from anon, authenticated;
