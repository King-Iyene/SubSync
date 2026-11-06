-- Who belongs to which client account (read from the CRM users list per account, users.readonly). Additive. Powers the Owner picker and the
-- server check that an owner change names someone who really belongs to that account. Not applied automatically.
create table if not exists public.location_users (
  installation_id uuid not null references public.installations (id) on delete cascade,
  location_id text not null,
  user_id text not null,
  name text not null,
  seen_at timestamptz not null default now(),
  primary key (installation_id, location_id, user_id)
);
alter table public.location_users enable row level security;
