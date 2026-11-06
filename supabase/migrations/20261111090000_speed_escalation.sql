-- Stage SPEED5: the escalation ladder (company-wide): { enabled, nextAfterMin, managerAfterMin }. Additive, nullable; nothing reads it as required.
-- Until this runs, the default ladder applies and saving answers "needs the latest database update".
alter table public.settings add column if not exists speed_escalation jsonb;
