-- Additive: a message sent from the contact panel composer is also kept in the write log, so it is never counted as a first reply (principle 14).
alter table public.crm_writes drop constraint if exists crm_writes_kind_check;
alter table public.crm_writes add constraint crm_writes_kind_check check (kind in ('note', 'comment', 'field', 'message'));
