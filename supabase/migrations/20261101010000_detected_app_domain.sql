-- Additive: remember the login domain a company's sign-in or install event showed us, separately from the one typed in Settings.
-- The typed one is an override that wins, but it can now be taken off again because the detected one is still here.
-- Nothing is changed or removed; the old code simply does not read this column.
alter table public.settings add column if not exists detected_app_domain text;
