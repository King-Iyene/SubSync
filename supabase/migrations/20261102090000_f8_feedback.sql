-- Stage F8 (Settings, Getting started, roadmap, trust). Additive only: two new tables, nothing existing is changed, renamed or removed, and the previous
-- release simply does not read them, so the old code keeps working against this database. Idempotent.
--
-- feedback_items: "Give feedback" (kind 'feedback') and "Report a problem" (kind 'problem'), stored and never sent anywhere (the alert to King is a dry-run
--   audit line written by the app, see src/lib/feedback.ts).
--   who          the person's key (kind, account, sign-in id), made on the server from the verified session
--   role         the kind of session (agency, business or client), so King can see who is asking
--   location_id  a client's or business's own account, when the session is limited to one
--   page         the menu page they were on (a short id, never free text)
--   message      what they typed (personal free text: it is listed in "What we store")
--   error_id     the error ID shown on the screen, for a problem report
--   status       new, seen or done: set by King's admin view
-- roadmap_suggestions: "Suggest something" on the What's new page. Visible only to the person's own company and to King's admin view.
create table if not exists public.feedback_items (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null references public.installations (id) on delete cascade,
  kind text not null check (kind in ('feedback', 'problem')),
  who text not null,
  role text,
  location_id text,
  page text,
  severity text,
  message text not null,
  error_id text,
  status text not null default 'new' check (status in ('new', 'seen', 'done')),
  created_at timestamptz not null default now()
);
create index if not exists feedback_items_installation_idx on public.feedback_items (installation_id, created_at desc);
create index if not exists feedback_items_who_idx on public.feedback_items (installation_id, who, created_at desc);
alter table public.feedback_items enable row level security;

create table if not exists public.roadmap_suggestions (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null references public.installations (id) on delete cascade,
  who text not null,
  role text,
  title text not null,
  details text,
  importance text not null default 'nice' check (importance in ('nice', 'important', 'critical')),
  page text,
  status text not null default 'new' check (status in ('new', 'planned', 'building', 'shipped', 'declined')),
  created_at timestamptz not null default now()
);
create index if not exists roadmap_suggestions_installation_idx on public.roadmap_suggestions (installation_id, created_at desc);
alter table public.roadmap_suggestions enable row level security;
