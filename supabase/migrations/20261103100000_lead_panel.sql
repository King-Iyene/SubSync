-- Lead panel: the day SubSync first stored a contact. The CRM does not say when a tag was added, so a tag with no recorded "added" event is shown as
-- "before SubSync started watching (first seen on this day)". Additive: one column with a default; the sync upsert never touches it.
-- Existing rows get the migration time, the latest day SubSync could have first seen them.
alter table public.cached_contacts add column if not exists first_seen_at timestamptz not null default now();
