-- Team (People) module, slice PD: the owner at the time. Outcomes (showed, won, lost) are credited to whoever owned the appointment or deal WHEN it happened, not to today's owner.
-- Built on the append-only histories we already keep (appointment_history and deal_history, kind = 'owner'); nothing is copied, so history cannot drift. Additive only.
-- One row per stretch of ownership. from_at is minus infinity for the first owner we saw (the sync may have seen the record after it was created); to_at is infinity for the current owner.
-- user_id is null for a stretch when nobody owned it. A record with no owner events has no row: the reader then uses the record's current owner.
create or replace view public.appointment_owner_spans as
select installation_id, location_id, appointment_id, to_value as user_id,
  case when row_number() over w = 1 then '-infinity'::timestamptz else at end as from_at,
  coalesce(lead(at) over w, 'infinity'::timestamptz) as to_at
from public.appointment_history
where kind = 'owner'
window w as (partition by installation_id, location_id, appointment_id order by at, id);

create or replace view public.deal_owner_spans as
select installation_id, location_id, opportunity_id, to_value as user_id,
  case when row_number() over w = 1 then '-infinity'::timestamptz else at end as from_at,
  coalesce(lead(at) over w, 'infinity'::timestamptz) as to_at
from public.deal_history
where kind = 'owner'
window w as (partition by installation_id, location_id, opportunity_id order by at, id);

revoke all on public.appointment_owner_spans from anon, authenticated;
revoke all on public.deal_owner_spans from anon, authenticated;
