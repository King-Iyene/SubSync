-- Round 4 speed. Additive and idempotent (only "create index if not exists"). Not applied by hand: it ships through the pull request (fresh-database check), then the production
-- apply is approved by King.
--
-- "People waiting for a reply" (the Unanswered list, Speed to lead, Clients, Today) and the people who have gone quiet read cached_conversations by who wrote last and when. Without
-- these two partial indexes each read scans every conversation of the installation; with them it reads only the conversations in the last 30 days for that side.
create index if not exists cached_conversations_inbound_last_idx on public.cached_conversations (installation_id, location_id, last_message_at desc) where last_message_direction = 'inbound';
create index if not exists cached_conversations_outbound_last_idx on public.cached_conversations (installation_id, location_id, last_message_at desc) where last_message_direction = 'outbound';
