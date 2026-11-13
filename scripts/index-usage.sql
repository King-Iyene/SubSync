-- Read-only. Run on the live database to see which cached_contacts indexes are used and what they cost.
-- An index is a drop candidate only when idx_scan stays 0 over a full week of normal use (stats reset on restart, so compare with stats_reset).
select s.indexrelname as index, s.idx_scan, pg_size_pretty(pg_relation_size(s.indexrelid)) as size, i.indisunique as is_unique, i.indisprimary as is_primary
from pg_stat_user_indexes s join pg_index i on i.indexrelid = s.indexrelid
where s.relname = 'cached_contacts'
order by pg_relation_size(s.indexrelid) desc;
select datname, stats_reset from pg_stat_database where datname = current_database();
