-- F2 speed to lead. Additive only.
-- excluded: why a contact is not counted as a lead (import, spam, test, dnd, duplicate), null when it counts.
-- clock_start: when the reply clock starts when business hours are on (a lead that arrives out of hours starts at the next opening), null means lead_at.
alter table public.lead_touches add column if not exists excluded text;
alter table public.lead_touches add column if not exists clock_start timestamptz;
alter table public.settings add column if not exists speed_business_hours boolean not null default false;
alter table public.settings add column if not exists speed_open_hour int not null default 9;
alter table public.settings add column if not exists speed_close_hour int not null default 17;
