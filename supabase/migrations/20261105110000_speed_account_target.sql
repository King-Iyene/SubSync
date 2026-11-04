-- Speed to lead (stage SPEED): each client account may have its OWN reply target in minutes, typed by a person on the Speed to lead screen.
-- Additive and idempotent: one new nullable column. Null means "use the default target in Settings", which is what every existing account does.
-- The old code never reads it; the new code works without it (an account without the column simply uses the default target).
alter table public.locations add column if not exists speed_target_minutes integer;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'locations_speed_target_minutes_range') then
    alter table public.locations add constraint locations_speed_target_minutes_range check (speed_target_minutes is null or (speed_target_minutes between 1 and 1440));
  end if;
end $$;
