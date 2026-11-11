-- Appointments: indexes for the filtered reads (account, calendar, person, date) at a million rows. Additive and safe to re-run. Not applied by hand.
create index if not exists cached_appointments_inst_loc_start_idx on public.cached_appointments (installation_id, location_id, start_at desc);
create index if not exists cached_appointments_inst_cal_start_idx on public.cached_appointments (installation_id, calendar_id, start_at desc);
create index if not exists cached_appointments_inst_owner_start_idx on public.cached_appointments (installation_id, assigned_to, start_at desc);
create index if not exists cached_appointments_inst_booker_start_idx on public.cached_appointments (installation_id, booked_by_user, start_at desc);
