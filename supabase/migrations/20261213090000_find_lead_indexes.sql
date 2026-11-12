-- Find a lead (docs/features/FINDLEAD_BRIEF.md). Additive and idempotent. Not applied automatically (King approves the production apply).
-- Four modest indexes so search and "Load more" stay quick at millions of people (checked in CI on 1,000,000 generated contacts, every read must answer in under one second):
--  1. recent: exactly the sort order of the search (newest activity first, then added, account, contact) so the database walks the index and stops after one page, and the "after" test is a jump.
--  2-4. prefix (text_pattern_ops) on the lower-cased full name, last name and email: typing the start of a name or an email is a range read, never a scan of every row.
-- Whose lead it is (owner) is the fifth, partial (nobody-owned people cost nothing). Estimated size per 1,000,000 people: recent about 75 MB, each prefix index about 45 MB, owner about 30 MB.
-- The trigram indexes from init_schema stay (phone digits use them).
do $$
begin
  if to_regclass('public.cached_contacts') is not null then
    create index if not exists cached_contacts_owner_idx on public.cached_contacts (installation_id, assigned_to, location_id) where assigned_to is not null and assigned_to <> '';
    create index if not exists cached_contacts_recent_idx on public.cached_contacts (installation_id, (coalesce(last_activity_at, '-infinity'::timestamptz)), (coalesce(date_added, '-infinity'::timestamptz)), location_id, contact_id);
    create index if not exists cached_contacts_fullname_prefix_idx on public.cached_contacts (installation_id, (lower(full_name)) text_pattern_ops);
    create index if not exists cached_contacts_lastname_prefix_idx on public.cached_contacts (installation_id, (lower(last_name)) text_pattern_ops);
    create index if not exists cached_contacts_email_prefix_idx on public.cached_contacts (installation_id, (lower(email)) text_pattern_ops);
  end if;
end
$$;
