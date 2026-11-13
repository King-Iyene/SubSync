-- Power dialer hand-off: remember that a person pressed "Mark as set up" for the call queue workflow they built by hand in their CRM. Additive only.
-- Until this runs, marking answers "needs the latest database update" and the setup state falls back to "not sure".
alter table public.call_queue_settings add column if not exists workflow_marked_at timestamptz;
