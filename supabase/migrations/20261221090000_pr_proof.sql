-- Branded client Proof page and monthly report (stage PR). Additive only.
-- 1) pr_settings: how one company brands the reports it sends to its clients (name, logo, colour, intro, which sections, whether staff are named, auto-prepared drafts).
-- 2) pr_reports: one prepared report per client account per month: the measured figures are frozen in the row so what was sent never changes afterwards.
-- 3) pr_links: ONE secret link per client account. Only a hash of the token is searched; the token itself is stored encrypted so the owner can copy the link again.
do $$
begin
  create table if not exists public.pr_settings (
    installation_id uuid primary key references public.installations (id) on delete cascade,
    display_name text,
    logo_url text,
    brand_color text,
    intro text,
    sections jsonb not null default '{}'::jsonb,
    name_staff boolean not null default false,
    auto_draft boolean not null default true,
    updated_by text,
    updated_at timestamptz not null default now()
  );
  alter table public.pr_settings enable row level security;
  revoke all on public.pr_settings from anon, authenticated;

  create table if not exists public.pr_reports (
    id bigint generated always as identity primary key,
    installation_id uuid not null references public.installations (id) on delete cascade,
    location_id text not null,
    period date not null,
    status text not null default 'draft' check (status in ('draft', 'shared')),
    payload jsonb not null,
    intro text,
    sections jsonb not null default '{}'::jsonb,
    name_staff boolean not null default false,
    auto_prepared boolean not null default false,
    built_at timestamptz not null default now(),
    shared_at timestamptz,
    shared_by text,
    unique (installation_id, location_id, period)
  );
  create index if not exists pr_reports_inst_period_idx on public.pr_reports (installation_id, period desc);
  alter table public.pr_reports enable row level security;
  revoke all on public.pr_reports from anon, authenticated;

  create table if not exists public.pr_links (
    installation_id uuid not null references public.installations (id) on delete cascade,
    location_id text not null,
    token_hash text not null unique,
    token_enc text not null,
    created_at timestamptz not null default now(),
    rotated_at timestamptz,
    revoked_at timestamptz,
    views integer not null default 0,
    last_viewed_at timestamptz,
    primary key (installation_id, location_id)
  );
  alter table public.pr_links enable row level security;
  revoke all on public.pr_links from anon, authenticated;
end $$;
