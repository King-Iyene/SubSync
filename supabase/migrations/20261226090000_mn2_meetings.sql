-- Additive: Meeting notes, finished (docs/features/MEETINGS_BRIEF.md slices 1, 2 and 6). Safe to run twice. Not applied by hand: it ships through the pull request check and the production approval.
-- 1. What a call knows about itself, kept next to the call (private to the person who recorded it, like the rest of the row): its length, the share of the talking the recorder did
--    (only when the person's own choices let the transcript be read for that one delivery; the text is never kept) and the contact it was matched to with certainty.
alter table public.meetings add column if not exists duration_minutes integer;
alter table public.meetings add column if not exists talk_pct smallint;
alter table public.meetings add column if not exists matched_location_id text;
alter table public.meetings add column if not exists matched_contact_id text;
alter table public.meetings add column if not exists matched_at timestamptz;
create index if not exists meetings_list_idx on public.meetings (installation_id, owner_ghl_user_id, (coalesce(started_at, created_at)) desc, id desc);
create index if not exists meetings_matched_idx on public.meetings (installation_id, matched_location_id, matched_contact_id) where matched_contact_id is not null;

-- 2. Calls that were already written to a contact before this column existed: take the contact from the write log (ids only), once.
do $$
begin
  update public.meetings m set matched_location_id = w.location_id, matched_contact_id = w.contact_id, matched_at = w.created_at
  from (select distinct on (meeting_id) meeting_id, location_id, contact_id, created_at from public.crm_writes where kind = 'note' and meeting_id is not null order by meeting_id, created_at) w
  where w.meeting_id = m.id and m.matched_contact_id is null;
end $$;

-- 3. Tasks made from a call's action items. One row per meeting and item, so the same item is never made twice. Ids and a status only: never the words of the item or of the call.
--    These rows are SubSync's own writes: the echo of the task the CRM reports back is dropped, and the task never counts as activity or a reply (rule 14).
create table if not exists public.mn_tasks (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null references public.installations (id) on delete cascade,
  owner_ghl_user_id text not null,
  meeting_id uuid not null references public.meetings (id) on delete cascade,
  item_no integer not null,
  location_id text not null,
  contact_id text not null,
  status text not null default 'pending' check (status in ('pending', 'saved', 'dry_run', 'failed', 'needs_permission', 'undone')),
  ghl_task_id text,
  created_at timestamptz not null default now(),
  undone_at timestamptz,
  unique (meeting_id, item_no)
);
create index if not exists mn_tasks_owner_idx on public.mn_tasks (installation_id, owner_ghl_user_id, created_at desc);
create index if not exists mn_tasks_echo_idx on public.mn_tasks (installation_id, ghl_task_id) where ghl_task_id is not null;
alter table public.mn_tasks enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on table public.mn_tasks from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on table public.mn_tasks from authenticated;
  end if;
end $$;
