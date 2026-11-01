-- F3: who booked an appointment and how, and the account's own show-rate target. Additive and idempotent. Nothing here changes or removes existing data.
-- The platform's event may or may not say who booked it; both columns stay empty when it does not (the screen says "not recorded").

alter table public.cached_appointments add column if not exists booked_by_user text;
alter table public.cached_appointments add column if not exists booking_channel text;

-- null means the default target (75%). Changed by an owner on the Appointments page.
alter table public.settings add column if not exists appointment_show_rate_target integer;
