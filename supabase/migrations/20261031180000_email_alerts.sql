-- F9 alert emails. Additive only.
-- email_notified_at: when this alert was emailed, tracked apart from Slack so one channel cannot hide an alert from the other.
-- alert_quiet_hours: warning alerts wait for the morning (21:00 to 07:00 in the brief's time zone); critical ones are always sent at once.
alter table public.alerts add column if not exists email_notified_at timestamptz;
alter table public.settings add column if not exists alert_quiet_hours boolean not null default true;
