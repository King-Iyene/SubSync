-- Meeting notes can also be written into the matched contact in the CRM. Additive only.
alter table public.settings add column if not exists push_notes_to_crm boolean not null default true;
alter table public.meeting_notes add column if not exists crm_note_id text;
alter table public.meeting_notes add column if not exists crm_note_status text;
