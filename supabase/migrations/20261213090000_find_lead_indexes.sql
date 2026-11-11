-- Find a lead (docs/features/FINDLEAD_BRIEF.md). Additive and idempotent. Not applied automatically (King approves the production apply).
-- ONE modest index: "whose lead is this" (the Owner filter and the owner check of the keyset search). Partial, so people with no owner (the most common case in a messy account) cost nothing.
-- Roughly 40 bytes a row. The name, email and phone trigram indexes, the tags index and the activity index already exist (init_schema, feature_schema, f10_people), so nothing else is added:
-- the database is small and every extra index on cached_contacts slows every sync write.
do $$
begin
  if to_regclass('public.cached_contacts') is not null then
    create index if not exists cached_contacts_owner_idx on public.cached_contacts (installation_id, assigned_to, location_id) where assigned_to is not null and assigned_to <> '';
  end if;
end
$$;
