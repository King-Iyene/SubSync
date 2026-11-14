-- Feedback inbox for the platform owner and owner alerts. Additive only: three new tables, nothing existing is changed. Idempotent.
-- These are platform tables (no customer data, no installation_id): they hold the owner's triage marks, the owner's own alert choices and the state that
-- keeps alerts from repeating. Only the owner-only routes (src/app/api/app, owner/feedback) and the owner digest cron read or write them.
--   feedback_triage         status the owner set on one item (new, seen, planned, done, wontfix), by item kind and id
--   feedback_owner_settings the owner's choices: daily summary on/off (null = follow FEEDBACK_DIGEST) and how many kinds of item raise an instant alert
--   feedback_alert_state    per alert key (a severity, or "digest"): when the last alert went, how many were held back since, and the last record of what was (or would be) sent
create table if not exists public.feedback_triage (
  item_kind text not null check (item_kind in ('feedback', 'suggestion')),
  item_id uuid not null,
  status text not null check (status in ('new', 'seen', 'planned', 'done', 'wontfix')),
  changed_by text,
  changed_at timestamptz not null default now(),
  primary key (item_kind, item_id)
);
alter table public.feedback_triage enable row level security;

create table if not exists public.feedback_owner_settings (
  id text primary key default 'owner' check (id = 'owner'),
  digest_on boolean,
  instant_level text not null default 'stuck' check (instant_level in ('stuck', 'stuck_annoying', 'everything')),
  changed_by text,
  changed_at timestamptz not null default now()
);
alter table public.feedback_owner_settings enable row level security;

create table if not exists public.feedback_alert_state (
  key text primary key,
  last_alert_at timestamptz,
  suppressed integer not null default 0,
  last_ref text,
  detail jsonb,
  updated_at timestamptz not null default now()
);
alter table public.feedback_alert_state enable row level security;
