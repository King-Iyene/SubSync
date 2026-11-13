-- Automatic call-queue workflow (additive only). auto_publish: publish right after creating (default yes: the workflow only creates internal call tasks and sends nothing).
-- auto_setup now defaults to on for new rows (the write gateway still keeps every write a dry run until the account opts in). checked_at: when the daily check last looked.
alter table public.workflow_setup_settings add column if not exists auto_publish boolean not null default true;
alter table public.workflow_setup_settings alter column auto_setup set default true;
alter table public.workflow_setup add column if not exists checked_at timestamptz;
