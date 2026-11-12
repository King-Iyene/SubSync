-- Clean-up v2 / data quality moat (docs/research/DATAQUALITY_R1.md). Additive and idempotent. Not applied by hand: it ships through the pull request (fresh-database check),
-- then the production apply is approved by King.
--
-- dq_groups        the duplicate groups of each account, rebuilt by the nightly scan from blocking keys (never a pairwise scan). Ids and a tier only: no name, email or phone.
-- dq_events        append-only history: a group found, a decision made, a delete or a bulk run. The platform keeps none of this, so it cannot be rebuilt later: it is the moat.
-- dq_source_daily  one row per account, day and lead source: how many leads came in and what became of them (duplicate, junk, answered, booked, showed, won, money). Counts only.
-- dq_forms         the forms, surveys and funnels of each account (names and ids), read when the optional permissions are granted.
-- dq_submissions   one row per form or survey submission (ids and a time), so each form can be measured through the contacts it made.
-- dq_scores        the quality score of each account per day with its four parts (counts and points only).
-- dq_poll          when each account's forms, surveys and funnels were last read and whether the permission was there.
-- dq_mutes         "do not alert me about this source or account" and the day it ends.

do $$
begin
  create table if not exists public.dq_groups (
    installation_id uuid not null references public.installations (id) on delete cascade,
    location_id text not null,
    group_key text not null,
    tier text not null check (tier in ('certain', 'likely', 'possible')),
    tier_rank smallint not null,
    kinds text[] not null default '{}',
    contact_ids text[] not null,
    size smallint not null,
    trimmed boolean not null default false,
    found_at timestamptz not null default now(),
    seen_at timestamptz not null default now(),
    primary key (installation_id, location_id, group_key)
  );
  create index if not exists dq_groups_page_idx on public.dq_groups (installation_id, tier_rank desc, location_id, group_key);
  alter table public.dq_groups enable row level security;
  revoke all on public.dq_groups from anon, authenticated;

  create table if not exists public.dq_events (
    id bigserial primary key,
    installation_id uuid not null references public.installations (id) on delete cascade,
    location_id text,
    kind text not null,
    ref text,
    detail jsonb not null default '{}'::jsonb,
    actor text,
    created_at timestamptz not null default now()
  );
  create index if not exists dq_events_inst_idx on public.dq_events (installation_id, created_at desc);
  alter table public.dq_events enable row level security;
  revoke all on public.dq_events from anon, authenticated;

  create table if not exists public.dq_source_daily (
    installation_id uuid not null references public.installations (id) on delete cascade,
    location_id text not null,
    day date not null,
    src text not null,
    label text not null,
    leads integer not null default 0,
    dups integer not null default 0,
    junk integer not null default 0,
    answered integer not null default 0,
    quality integer not null default 0,
    booked integer not null default 0,
    showed integer not null default 0,
    won integer not null default 0,
    won_value numeric not null default 0,
    touch_secs bigint not null default 0,
    touched integer not null default 0,
    taken_at timestamptz not null default now(),
    primary key (installation_id, location_id, day, src)
  );
  create index if not exists dq_source_daily_day_idx on public.dq_source_daily (installation_id, day desc);
  alter table public.dq_source_daily enable row level security;
  revoke all on public.dq_source_daily from anon, authenticated;

  create table if not exists public.dq_forms (
    installation_id uuid not null references public.installations (id) on delete cascade,
    location_id text not null,
    kind text not null check (kind in ('form', 'survey', 'funnel')),
    ext_id text not null,
    name text not null,
    steps integer,
    seen_at timestamptz not null default now(),
    primary key (installation_id, location_id, kind, ext_id)
  );
  alter table public.dq_forms enable row level security;
  revoke all on public.dq_forms from anon, authenticated;

  create table if not exists public.dq_submissions (
    installation_id uuid not null references public.installations (id) on delete cascade,
    location_id text not null,
    kind text not null check (kind in ('form', 'survey')),
    ext_id text not null,
    submission_id text not null,
    contact_id text,
    submitted_at timestamptz not null,
    primary key (installation_id, location_id, kind, submission_id)
  );
  create index if not exists dq_submissions_form_idx on public.dq_submissions (installation_id, location_id, kind, ext_id, submitted_at desc);
  create index if not exists dq_submissions_contact_idx on public.dq_submissions (installation_id, location_id, contact_id) where contact_id is not null;
  alter table public.dq_submissions enable row level security;
  revoke all on public.dq_submissions from anon, authenticated;

  create table if not exists public.dq_scores (
    installation_id uuid not null references public.installations (id) on delete cascade,
    location_id text not null,
    day date not null,
    score integer,
    dup_rate numeric not null default 0,
    completeness numeric not null default 0,
    validity numeric not null default 0,
    intake numeric,
    parts jsonb not null default '{}'::jsonb,
    rules_version text not null default 'dq-1',
    taken_at timestamptz not null default now(),
    primary key (installation_id, location_id, day)
  );
  create index if not exists dq_scores_day_idx on public.dq_scores (installation_id, day desc);
  alter table public.dq_scores enable row level security;
  revoke all on public.dq_scores from anon, authenticated;

  create table if not exists public.dq_poll (
    installation_id uuid not null references public.installations (id) on delete cascade,
    location_id text not null,
    area text not null,
    last_at timestamptz not null default now(),
    status text not null default 'ok',
    primary key (installation_id, location_id, area)
  );
  alter table public.dq_poll enable row level security;
  revoke all on public.dq_poll from anon, authenticated;

  create table if not exists public.dq_mutes (
    installation_id uuid not null references public.installations (id) on delete cascade,
    location_id text not null,
    src text not null default '*',
    until date,
    muted_by text,
    created_at timestamptz not null default now(),
    primary key (installation_id, location_id, src)
  );
  alter table public.dq_mutes enable row level security;
  revoke all on public.dq_mutes from anon, authenticated;
end
$$;

-- Blocking keys for the duplicate scan and for the check at entry ("is this new person already here?"). Two narrow partial indexes, nothing more: the name keys are computed in the
-- nightly scan only. They hold only rows that have the value, so a contact without a phone costs nothing.
do $$
begin
  if to_regclass('public.cached_contacts') is not null then
    create index if not exists dq_c_email_idx on public.cached_contacts (installation_id, location_id, (lower(btrim(email)))) where coalesce(email, '') <> '';
    create index if not exists dq_c_phone10_idx on public.cached_contacts (installation_id, location_id, (right(phone_digits, 10))) where length(phone_digits) >= 10;
  end if;
end
$$;
