-- Clients v3 (money control center). Additive only.
-- 1) cl3_app_installs: whether SubSync itself is installed on each client account, as the platform reports it (installed-locations list). Other apps are NOT readable from the platform.
-- 2) cl3_history: our own append-only record of changes the platform only shows as "now" (plan, payment status, wallet low, app installed or removed). It is the moat: it cannot be rebuilt later.
do $$
begin
  create table if not exists public.cl3_app_installs (
    installation_id uuid not null references public.installations (id) on delete cascade,
    location_id text not null,
    name text,
    is_installed boolean not null,
    version_id text,
    installed_at timestamptz,
    seen_at timestamptz not null default now(),
    primary key (installation_id, location_id)
  );
  alter table public.cl3_app_installs enable row level security;
  revoke all on public.cl3_app_installs from anon, authenticated;

  create table if not exists public.cl3_history (
    id bigint generated always as identity primary key,
    installation_id uuid not null references public.installations (id) on delete cascade,
    location_id text not null,
    kind text not null check (kind in ('plan', 'status', 'wallet_low', 'app_installed', 'app_removed')),
    from_value text,
    to_value text,
    at timestamptz not null default now()
  );
  create index if not exists cl3_history_inst_at_idx on public.cl3_history (installation_id, id desc);
  create index if not exists cl3_history_account_idx on public.cl3_history (installation_id, location_id, id desc);
  alter table public.cl3_history enable row level security;
  revoke all on public.cl3_history from anon, authenticated;
end $$;
