-- Capture tab: the newest contacts with an email, read in index order so the 40,000-row read needs no disk sort (measured 3.3 s of execution on a 50,000-contact account).
-- Additive only. Not applied yet: apply with the usual migration step, then re-run EXPLAIN ANALYZE on the Capture read to confirm the Sort node is gone.
create index if not exists cached_contacts_capture_idx
  on public.cached_contacts (installation_id, date_added desc)
  where email is not null and date_added is not null;
