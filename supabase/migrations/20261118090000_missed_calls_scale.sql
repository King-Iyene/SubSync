-- Additive (Missed calls, stage MISSED: scale). NOT applied by the build: run it when you are ready (only adds indexes, nothing is changed or removed).
-- Why: "missed calls nobody called back" is one SQL read (src/lib/analytics/missed-calls.ts) shared by Speed > Coverage and Speed > Call mode. It finds the missed calls of a
-- date range, then checks per caller that no outbound touch and no logged call outcome came after. These indexes keep that an index range scan plus one index probe
-- per caller, so 100,000 missed calls and 1,000,000+ leads stay fast. Idempotent (if not exists).

-- The missed calls of a date range, across every account of one company.
create index if not exists touch_events_missed_idx on public.touch_events (installation_id, at desc) include (location_id, contact_id) where kind = 'missed_call';
-- The "did anyone reach out after?" probe, per caller: outbound touches only, in time order.
create index if not exists touch_events_outbound_after_idx on public.touch_events (installation_id, location_id, contact_id, at) where direction = 'outbound';
-- Open deals of a caller (the dollars next to the name).
create index if not exists cached_opportunities_open_contact_idx on public.cached_opportunities (installation_id, location_id, contact_id) where status = 'open';
-- Call mode's Redial list: calls logged in Call mode, newest first.
create index if not exists touch_events_subsync_call_idx on public.touch_events (installation_id, at desc) include (location_id, contact_id, outcome) where source = 'subsync_call';
