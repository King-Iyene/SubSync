-- Scale test (docs/QA_SCALE.md): indexes found missing at 100,000 leads. Additive only; safe to run on a live database (small tables build in a moment, large ones in seconds).
-- 1. The appointment screens find, per appointment, the lead record that came before it ("lead_touches x where contact_id = ... order by lead_at desc limit 1").
--    Without a contact key that was a scan of the account's leads for every appointment.
create index if not exists lead_touches_contact_idx on public.lead_touches (installation_id, location_id, contact_id, lead_at desc);

-- 2. Double bookings: same person, overlapping times, one account.
create index if not exists cached_appointments_owner_loc_start_idx on public.cached_appointments (installation_id, location_id, assigned_to, start_at) where assigned_to is not null;
