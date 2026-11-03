-- Stage F4 (Unanswered messages). Additive only: one new table, nothing existing is changed, renamed or removed, and the previous release simply
-- does not read it, so the old code keeps working against this database.
--
-- Saved views: a person's own named choices on a page (for example "Over a day, WhatsApp, mine"), kept per person.
--   owner    who saved it: the same key the roadmap votes use (kind, account, sign-in id), so a person sees only their own views
--   page     which page the view belongs to ('inbox' today)
--   filters  the choices as small JSON (tab, wait chip, channel, client account id, person, sort). No customer data is stored in it.
create table if not exists public.saved_views (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null references public.installations (id) on delete cascade,
  owner text not null,
  page text not null default 'inbox',
  name text not null,
  filters jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create unique index if not exists saved_views_owner_name_idx on public.saved_views (installation_id, owner, page, name);
alter table public.saved_views enable row level security;
