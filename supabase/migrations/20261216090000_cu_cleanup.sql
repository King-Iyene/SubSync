-- Clean-up module (docs/features/CLEANUP_BRIEF.md and DATA_HEALTH_BRIEF.md). Additive and idempotent. Not applied by hand: it ships through the pull request (fresh-database check),
-- then the production apply is approved by King.
--
-- 1. cu_scans: one row per client account per day with COUNTS only (never a name, an email or a phone number). It is the history the Health tab draws its trend from. Idempotent per
--    (account, day): the sweep writes it with an upsert.
-- 2. cu_actions: one row per bulk run (dry run or live): what was asked, how many were protected and skipped, how many were done. Counts and ids only.
-- 3. Partial indexes so each list ("no owner", "no phone", "junk" ...) is a short index walk and a page of 50 stays fast at millions of contacts. An index holds only the rows that
--    match, so a clean account costs almost nothing. The predicates are written exactly as the queries write them (src/lib/cleanup/cu-core.ts), or the planner cannot use them.

do $$
begin
  create table if not exists public.cu_scans (
    installation_id uuid not null references public.installations (id) on delete cascade,
    location_id text not null,
    day date not null,
    contacts integer not null default 0,
    deals_open integer not null default 0,
    dup_groups integer not null default 0,
    dup_extra integer not null default 0,
    junk integer not null default 0,
    no_owner integer not null default 0,
    no_phone integer not null default 0,
    no_email integer not null default 0,
    no_source integer not null default 0,
    bad_phone integer not null default 0,
    bad_email integer not null default 0,
    stale_deals integer not null default 0,
    ownerless_deals integer not null default 0,
    orphan_deals integer not null default 0,
    protected_contacts integer not null default 0,
    score integer,
    rules_version text not null default 'cu-health-1',
    taken_at timestamptz not null default now(),
    primary key (installation_id, location_id, day)
  );
  create index if not exists cu_scans_day_idx on public.cu_scans (installation_id, day desc);
  alter table public.cu_scans enable row level security;
  revoke all on public.cu_scans from anon, authenticated;

  create table if not exists public.cu_actions (
    id bigserial primary key,
    installation_id uuid not null references public.installations (id) on delete cascade,
    location_id text not null,
    kind text not null,
    action text not null,
    mode text not null,
    requested integer not null default 0,
    protected_skipped integer not null default 0,
    done integer not null default 0,
    failed integer not null default 0,
    typed_ok boolean not null default false,
    actor text,
    note text,
    created_at timestamptz not null default now()
  );
  create index if not exists cu_actions_inst_idx on public.cu_actions (installation_id, created_at desc);
  alter table public.cu_actions enable row level security;
  revoke all on public.cu_actions from anon, authenticated;
end
$$;

do $$
begin
  if to_regclass('public.cached_contacts') is not null then
    -- Contacts: the key is narrow (account and contact id) so a keyset page is an index range read.
    create index if not exists cu_c_noowner_idx on public.cached_contacts (installation_id, location_id, contact_id) where coalesce(assigned_to, '') = '';
    create index if not exists cu_c_nophone_idx on public.cached_contacts (installation_id, location_id, contact_id) where phone_digits = '';
    create index if not exists cu_c_noemail_idx on public.cached_contacts (installation_id, location_id, contact_id) where coalesce(email, '') = '';
    create index if not exists cu_c_nosource_idx on public.cached_contacts (installation_id, location_id, contact_id) where coalesce(source, '') = '';
    create index if not exists cu_c_badphone_idx on public.cached_contacts (installation_id, location_id, contact_id) where phone_digits <> '' and (length(phone_digits) < 7 or length(phone_digits) > 15);
    create index if not exists cu_c_bademail_idx on public.cached_contacts (installation_id, location_id, contact_id) where coalesce(email, '') <> '' and email !~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]{2,}$';
    create index if not exists cu_c_junk_idx on public.cached_contacts (installation_id, location_id, contact_id) where lower(coalesce(full_name, '')) ~ '^(test|testing|asdf|asdfgh|qwerty|xxx+|zzz+|demo|sample|fake|dummy|do not use)( .*)?$' or lower(coalesce(email, '')) ~ '(^(test|asdf|fake|demo|dummy)[0-9._+-]*@)|(@(example|mailinator|yopmail|tempmail|guerrillamail)[.])';
  end if;
  if to_regclass('public.cached_opportunities') is not null then
    -- Deals: "is this contact in an open deal" is asked for every row on a page, so it needs its own key.
    create index if not exists cu_o_contact_open_idx on public.cached_opportunities (installation_id, location_id, contact_id) where status = 'open';
    create index if not exists cu_o_open_idx on public.cached_opportunities (installation_id, location_id, opportunity_id) where status = 'open';
  end if;
end
$$;
