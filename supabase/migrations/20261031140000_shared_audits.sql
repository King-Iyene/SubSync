-- A shareable snapshot of the account audit: totals and finding titles only, no account names, no contact data.
-- The id is long and random, the link expires, and the owner can see that it exists. Additive only.
create table if not exists public.shared_audits (
  id text primary key,
  installation_id uuid not null references public.installations (id) on delete cascade,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 days')
);
alter table public.shared_audits enable row level security;
