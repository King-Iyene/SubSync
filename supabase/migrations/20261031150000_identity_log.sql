-- One row per sign-in: which role, what happened. No names, no emails, no person ids. Additive only.
create table if not exists public.identity_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  installation_id uuid references public.installations (id) on delete cascade,
  user_type text,
  role text,
  is_agency_owner boolean,
  has_location boolean,
  outcome text not null
);
create index if not exists identity_log_installation_idx on public.identity_log (installation_id, at desc);
alter table public.identity_log enable row level security;
