-- Weekly email digest: where to send it, and the last Monday it went out. Additive only.
alter table public.settings add column if not exists digest_email text;
alter table public.settings add column if not exists last_weekly_digest_on date;
