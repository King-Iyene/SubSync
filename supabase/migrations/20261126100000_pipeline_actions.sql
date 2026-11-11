-- Pipeline module, slice PB (deal actions). Additive and idempotent. Not applied automatically.
-- Action log: one row per deal changed from SubSync (stage, owner, value, status with lost reason, rename, note, task, remove, undo). Ids, a status, a number and a reason code only;
-- never a name, a note's words or a message. `before_value` holds what is needed to put a change back; a removal, a note and a task cannot be put back. Rows whose result is
-- 'done' are SubSync's own writes: deal history and every metric skip the platform's echo of them (rule 14).
create table if not exists public.pipeline_actions (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null references public.installations (id),
  location_id text not null,
  batch_id uuid not null,
  action text not null check (action in ('stage', 'owner', 'value', 'status', 'rename', 'note', 'task', 'remove', 'undo')),
  opportunity_id text,
  contact_id text,
  before_value jsonb not null default '{}'::jsonb,
  after_value jsonb not null default '{}'::jsonb,
  lost_reason text check (lost_reason in ('price', 'no_response', 'competitor', 'not_ready', 'not_a_fit', 'bad_lead', 'other')),
  result text not null,
  actor text,
  created_at timestamptz not null default now()
);
create index if not exists pipeline_actions_batch_idx on public.pipeline_actions (installation_id, batch_id);
create index if not exists pipeline_actions_deal_idx on public.pipeline_actions (installation_id, location_id, opportunity_id, created_at desc);
create index if not exists pipeline_actions_reason_idx on public.pipeline_actions (installation_id, location_id, lost_reason) where lost_reason is not null;
alter table public.pipeline_actions enable row level security;
revoke all on public.pipeline_actions from anon, authenticated;
