-- Extra fields returned by the OAuth token exchange.
alter table public.installations
  add column if not exists scope text,
  add column if not exists user_type text,
  add column if not exists user_id text,
  add column if not exists is_bulk_installation boolean;
