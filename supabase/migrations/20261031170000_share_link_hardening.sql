-- F6 share link hardening. Additive only.
-- revoked_at: the owner switched the link off. views / last_viewed_at: how often it was opened. New links expire after 14 days.
alter table public.shared_audits add column if not exists revoked_at timestamptz;
alter table public.shared_audits add column if not exists views int not null default 0;
alter table public.shared_audits add column if not exists last_viewed_at timestamptz;
alter table public.shared_audits alter column expires_at set default (now() + interval '14 days');
