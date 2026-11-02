-- Stage F10 (People and Call lists). Additive only: one new table and one new index; nothing existing is changed, renamed or removed, and the previous
-- release simply does not read them, so the old code keeps working against this database.
--
-- contact_tag_events: the platform does not say WHEN a tag was added to a contact, so SubSync records each tag it sees added or removed at a sync
--   ("since SubSync started watching"). `at` is the moment SubSync noticed, not the moment the person tagged the contact.
--   It holds ids and tag names only (the tag names are already part of cached_contacts.tags). Removed with the rest of a client account's data.
create table if not exists public.contact_tag_events (
  id bigint generated always as identity primary key,
  installation_id uuid not null references public.installations (id) on delete cascade,
  location_id text not null,
  contact_id text not null,
  tag text not null,
  kind text not null check (kind in ('added', 'removed')),
  at timestamptz not null default now()
);
create index if not exists contact_tag_events_tag_idx on public.contact_tag_events (installation_id, tag, at desc);
create index if not exists contact_tag_events_contact_idx on public.contact_tag_events (installation_id, location_id, contact_id, at desc);
alter table public.contact_tag_events enable row level security;

-- Filtering a large account by tag read every contact; a GIN index lets "has this tag" use the index.
create index if not exists cached_contacts_tags_gin on public.cached_contacts using gin (tags);
