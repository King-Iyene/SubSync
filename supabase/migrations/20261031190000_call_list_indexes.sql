-- F10 call lists: the two lookups the call queue makes for each candidate contact had no index, so every list scanned whole tables.
-- Additive only (indexes).
create index if not exists call_outcomes_contact_idx on public.call_outcomes (installation_id, location_id, contact_id, created_at desc);
create index if not exists cached_conversations_contact_idx on public.cached_conversations (installation_id, location_id, contact_id);
