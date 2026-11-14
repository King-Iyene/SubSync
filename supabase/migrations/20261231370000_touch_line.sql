-- Additive: which business line (phone number) a call or message came in on. A number only, never content. Older rows stay empty.
alter table public.touch_events add column if not exists line text;
