-- Additive: the duplicate review queue, an action log, the duplicate-protection flag, and the
-- daily digest schedule. Nothing here changes or removes existing data.

-- What the user decided about a group of likely duplicates, with a copy of the records as they
-- looked at that moment (so the decision can be understood after the records are merged in the platform).
create table if not exists public.duplicate_reviews (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null references public.installations (id) on delete cascade,
  location_id text not null,
  group_key text not null,
  decision text not null check (decision in ('keep', 'not_duplicate', 'merged_in_platform')),
  keep_contact_id text,
  snapshot jsonb not null default '{}',
  decided_by text,
  decided_at timestamptz not null default now(),
  unique (installation_id, location_id, group_key)
);
create index if not exists duplicate_reviews_installation_idx on public.duplicate_reviews (installation_id, decided_at desc);

-- Every action taken in the app that records a decision (who, what, when).
create table if not exists public.audit_log (
  id bigserial primary key,
  installation_id uuid not null references public.installations (id) on delete cascade,
  actor text,
  action text not null,
  detail jsonb not null default '{}',
  at timestamptz not null default now()
);
create index if not exists audit_log_installation_idx on public.audit_log (installation_id, at desc);

-- Whether the client account blocks duplicate contacts, when the platform tells us.
alter table public.locations add column if not exists allow_duplicate_contact boolean;

-- When the agency wants its daily digest, and which day was last sent (so it goes out once).
alter table public.settings add column if not exists digest_hour integer;
alter table public.settings add column if not exists digest_timezone text;
alter table public.settings add column if not exists last_daily_digest_on date;

alter table public.duplicate_reviews enable row level security;
alter table public.audit_log enable row level security;
