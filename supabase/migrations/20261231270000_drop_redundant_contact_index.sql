-- Write load on cached_contacts (additive-safe: drops one index that is provably redundant; no data, constraint or tenant key is touched).
-- cached_contacts_loc_idx (installation_id, location_id) is the leading prefix of cached_contacts_activity_idx, cached_contacts_added_idx and cached_contacts_source_idx
-- (all start with installation_id, location_id), so every lookup it served is served by those, and each insert/update no longer maintains another copy of the same keys.
drop index if exists public.cached_contacts_loc_idx;
