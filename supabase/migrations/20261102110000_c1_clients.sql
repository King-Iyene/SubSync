-- Stage C1 (Clients). Additive only: four new tables, nothing existing is changed, renamed or removed, and the previous release simply does not read them,
-- so the old code keeps working against this database. Every table carries installation_id (cascade on uninstall) and is classified in
-- src/lib/tenant-tables.ts and src/lib/data-inventory.ts.
--
-- client_notes          the log of conversations and notes about a client: what was said or decided, who wrote it, and when it happened.
-- onboarding_templates  a checklist template the agency writes for a kind of client (an industry), with its steps as small JSON.
-- client_steps          the state of ONE onboarding step for ONE client: who is on it, when it is due, who finished it and when. Also holds the extra steps
--                       the agency adds to a single client (is_custom, with its own label). The automatic checks are never stored; they are worked out each time.
-- client_step_history   what happened to a step (finished, reopened, handed to someone, new due date, added, removed), with who and when.

create table if not exists public.client_notes (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null references public.installations (id) on delete cascade,
  location_id text not null,
  kind text not null default 'note' check (kind in ('conversation', 'note', 'decision')),
  body text not null,
  author text,
  occurred_on date not null default current_date,
  created_at timestamptz not null default now()
);
create index if not exists client_notes_location_idx on public.client_notes (installation_id, location_id, occurred_on desc, created_at desc);

create table if not exists public.onboarding_templates (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null references public.installations (id) on delete cascade,
  name text not null,
  industry_key text,
  steps jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists onboarding_templates_name_idx on public.onboarding_templates (installation_id, name);

create table if not exists public.client_steps (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null references public.installations (id) on delete cascade,
  location_id text not null,
  step_key text not null,
  is_custom boolean not null default false,
  label text,
  assignee text,
  due_on date,
  done_at timestamptz,
  done_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists client_steps_step_idx on public.client_steps (installation_id, location_id, step_key);

create table if not exists public.client_step_history (
  id bigserial primary key,
  installation_id uuid not null references public.installations (id) on delete cascade,
  location_id text not null,
  step_key text not null,
  step_label text,
  event text not null check (event in ('done', 'reopened', 'assigned', 'due', 'added', 'removed')),
  detail text,
  actor text,
  at timestamptz not null default now()
);
create index if not exists client_step_history_location_idx on public.client_step_history (installation_id, location_id, at desc);

alter table public.client_notes enable row level security;
alter table public.onboarding_templates enable row level security;
alter table public.client_steps enable row level security;
alter table public.client_step_history enable row level security;
revoke all on public.client_notes from anon, authenticated;
revoke all on public.onboarding_templates from anon, authenticated;
revoke all on public.client_steps from anon, authenticated;
revoke all on public.client_step_history from anon, authenticated;
