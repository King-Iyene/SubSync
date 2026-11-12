-- Sync and webhook reliability. Additive and idempotent. Ships through the pull request (fresh-database check); the production apply is approved by King.
--
-- 1. What became of each webhook event (handled, or why it was set aside), so "I added a person in the CRM and it never showed" can be answered from the table.
-- 2. A small index over only the open sync steps (pending or running): the worker claims from it every few seconds, and the scheduler asks the same question for every install,
--    so it should not read the whole history of finished steps each time.
alter table public.webhook_events add column if not exists outcome text;
alter table public.webhook_events add column if not exists handled_at timestamptz;

create index if not exists sync_jobs_open_idx on public.sync_jobs (installation_id, created_at) where status in ('pending', 'running');
