-- Call mode (stage DIAL): one optional call script per client account (plain text the person reads from; never sent anywhere). Additive.
alter table public.locations add column if not exists call_script text;
