-- Brings the migration files in line with the live database (the column already exists there). Additive and idempotent.
alter table public.cached_contacts add column if not exists first_seen_at timestamptz;
