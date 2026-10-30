-- Additive: remember where an install's CRM domain came from, so a domain taken from sign-in never
-- overwrites one the agency typed in Settings. Nothing here changes or removes existing data.
alter table public.settings add column if not exists app_domain_source text not null default 'default';
