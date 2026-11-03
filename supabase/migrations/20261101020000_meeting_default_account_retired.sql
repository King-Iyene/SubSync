-- N93 (stage S0.2b): the setting "if nobody in a meeting is a known contact, save it in [client account]" is gone. The app no longer reads or
-- writes connections.default_location_id, so any stored value would be a leftover that looks like a promise. Set every one to empty, which
-- means "do not save it, just count it". The column itself stays (additive only; nothing is dropped). Idempotent: running it again changes no row.
-- Applied by hand after saving the table to backups/ and recording row counts (docs/features/S0.2b.md).
update public.connections set default_location_id = null where default_location_id is not null;
