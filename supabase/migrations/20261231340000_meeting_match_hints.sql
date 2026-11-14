-- Fathom auto-matching: keep what a call tells us about WHO was on it, so a waiting call can be matched again later (when a contact is created or synced, and every night) and so
-- the Meeting inbox can suggest people by name. Additive only; nothing is read from or written to anyone else's row.
--   attendee_names  the names Fathom gave the outside invitees (private to the person who recorded the call, removed with the call when it is dismissed or leaves the inbox)
--   invitee_stats   counts only, never an address: how many invitees the delivery carried, how many had an email, how many were outside the recorder's company
--   rematched_at    the last time the nightly or after-sync pass looked at this waiting call again
alter table public.meetings add column if not exists attendee_names jsonb not null default '[]'::jsonb;
alter table public.meetings add column if not exists invitee_stats jsonb;
alter table public.meetings add column if not exists rematched_at timestamptz;
