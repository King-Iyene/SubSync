-- Kept so the migration history matches production (version 20261231270000 was recorded there on 13 Nov 2026).
-- The redundant index cached_contacts_loc_idx was already removed in production by this version.
-- The statement itself is not repeated here because the migration runner refuses destructive statements;
-- it lives in scripts/drop-redundant-contact-index.sql for reference. On a fresh database this file does nothing.
select 1;
