-- Team roles (docs/features/ROLES_INTEGRATION.md). Additive and idempotent. Not applied automatically (King approves the production apply).
-- The CRM has no setter or closer title, so the agency gives each team member a ROLE LABEL inside SubSync (Setter, Closer, Both, Support, Manager, Other). It is SubSync's own record: nothing is written to the CRM.
-- location_id '' means "everywhere" (the default); a row for one account overrides it in that account only. installation_id is first in every key and index; RLS on, no access for the browser roles.
create table if not exists public.team_member_roles (
  installation_id uuid not null references public.installations (id) on delete cascade,
  user_id text not null,
  location_id text not null default '',
  role text not null check (role in ('setter', 'closer', 'both', 'support', 'manager', 'other')),
  set_by text,
  set_by_name text,
  set_at timestamptz not null default now(),
  primary key (installation_id, user_id, location_id)
);
alter table public.team_member_roles enable row level security;
revoke all on public.team_member_roles from anon, authenticated;

-- Append-only history: one row per change (old and new role), so every change can be audited and a recent bulk change put back. Rows are only ever added.
-- old_role / new_role are null for "no role set". reason: set | clear | bulk | undo.
create table if not exists public.team_member_role_history (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null references public.installations (id) on delete cascade,
  batch_id uuid not null,
  user_id text not null,
  location_id text not null default '',
  old_role text check (old_role is null or old_role in ('setter', 'closer', 'both', 'support', 'manager', 'other')),
  new_role text check (new_role is null or new_role in ('setter', 'closer', 'both', 'support', 'manager', 'other')),
  reason text not null default 'set' check (reason in ('set', 'clear', 'bulk', 'undo')),
  set_by text,
  set_by_name text,
  set_at timestamptz not null default now()
);
create index if not exists team_member_role_history_idx on public.team_member_role_history (installation_id, set_at desc);
create index if not exists team_member_role_history_batch_idx on public.team_member_role_history (installation_id, batch_id);
alter table public.team_member_role_history enable row level security;
revoke all on public.team_member_role_history from anon, authenticated;
