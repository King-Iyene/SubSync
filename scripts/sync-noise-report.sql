-- Read-only. Sync jobs per install over the last day, so King can decide which test installs to uninstall.
select i.id as installation_id, i.company_id, count(*) filter (where j.status = 'failed') as failed, count(*) as jobs
from sync_jobs j join installations i on i.id = j.installation_id
where j.created_at > now() - interval '1 day'
group by i.id, i.company_id order by jobs desc limit 30;
