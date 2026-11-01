-- F2 Speed to lead, delta. Additive and idempotent: nothing here changes or removes existing data, and the previous code keeps working against it.
--
-- auto_touch_at: when the first AUTOMATIC outbound message (a workflow, a campaign, the API, a call with nobody attached) went out.
-- human_touch_at: when a PERSON first replied. Both are kept whatever the account's "count automatic messages" setting says, so the screen can show
--   the automatic first touch apart from the person's reply (N78). touch_at keeps its meaning (the touch the setting counts).
-- read_version: 0 for rows read before these columns existed. The speed sync re-reads such a lead once (newest first, 100 per run) and sets 1 (read in full)
--   or 2 (the conversation is longer than one page, so its first messages were not seen and the row is not used for the automatic-versus-person view).
--   Old rows fill in by themselves and nothing is guessed in the meantime.
alter table public.lead_touches add column if not exists auto_touch_at timestamptz;
alter table public.lead_touches add column if not exists human_touch_at timestamptz;
alter table public.lead_touches add column if not exists read_version smallint not null default 0;

-- The team list read from the CRM (users permission): the picture address that comes with each person, and when the person was last seen in the list.
alter table public.team_names add column if not exists photo_url text;
alter table public.team_names add column if not exists seen_at timestamptz;
