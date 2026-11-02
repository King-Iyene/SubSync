-- Stage E2a (Fathom per user, end to end). Additive and idempotent: two NEW tables, nothing existing is changed.
-- Row level security is on for both and NO policy is created, so the public (anon) and signed-in (authenticated) database roles read and write
-- nothing; those roles also lose their table privileges. Only server code, which connects with the database owner role, can use them.

-- One row per Fathom delivery that was accepted, so the same delivery (Fathom retries a delivery that was not acknowledged in time) is handled once.
-- It holds ids only, never any of the call. Rows older than 30 days are removed by the expiry job.
create table if not exists public.meeting_deliveries (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null references public.installations (id) on delete cascade,
  connection_id uuid not null references public.user_connections (id) on delete cascade,
  webhook_id text not null,
  created_at timestamptz not null default now()
);
create unique index if not exists meeting_deliveries_one_idx on public.meeting_deliveries (connection_id, webhook_id);
create index if not exists meeting_deliveries_age_idx on public.meeting_deliveries (created_at);
create index if not exists meeting_deliveries_installation_idx on public.meeting_deliveries (installation_id);

-- The email addresses one person told SubSync to "always ignore" in their Meeting inbox (a vendor, a family member). Private to that person.
create table if not exists public.meeting_ignored_emails (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null references public.installations (id) on delete cascade,
  ghl_user_id text not null,
  email text not null,
  created_at timestamptz not null default now()
);
create unique index if not exists meeting_ignored_emails_one_idx on public.meeting_ignored_emails (ghl_user_id, email);
create index if not exists meeting_ignored_emails_installation_idx on public.meeting_ignored_emails (installation_id);

alter table public.meeting_deliveries enable row level security;
alter table public.meeting_ignored_emails enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on table public.meeting_deliveries, public.meeting_ignored_emails from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on table public.meeting_deliveries, public.meeting_ignored_emails from authenticated;
  end if;
end $$;
