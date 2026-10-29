-- Controls competitors lack: ignore an account (snapshot or test accounts), assign an owner,
-- manual onboarding tasks and agency-defined checklist items.

alter table public.locations
  add column if not exists ignored boolean not null default false,
  add column if not exists owner text;

alter table public.settings
  add column if not exists custom_checklist jsonb not null default '[]';

create table public.onboarding_tasks (
  installation_id uuid not null references public.installations (id) on delete cascade,
  location_id text not null,
  task text not null,
  done boolean not null default true,
  done_at timestamptz not null default now(),
  primary key (installation_id, location_id, task)
);

alter table public.onboarding_tasks enable row level security;
revoke all on public.onboarding_tasks from anon, authenticated;
