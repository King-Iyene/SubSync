-- Additive: the Today working queue. Every press of Done, Snooze, Assign to me or Undo on a Fix first row is one row here, with who did it and when.
-- The table is append-only: nothing is edited, a person's Undo is a new row that points at the one it cancels. It lives only in SubSync, never in the CRM,
-- and is left out of every metric (what SubSync writes must never change what SubSync measures). Safe to run twice.

create table if not exists public.today_actions (
  id bigint generated always as identity primary key,
  installation_id uuid not null references public.installations (id) on delete cascade,
  location_id text not null,
  row_key text not null,
  kind text not null,
  -- action is done, snooze, assign or undo; the server is the only writer and checks it
  action text not null,
  -- 'team' for an agency or a business administrator (the team shares one queue), 'user:<id>' for a client's staff (their own queue only).
  lane text not null,
  actor_key text not null,
  actor_name text,
  actor_role text,
  until_at timestamptz,
  undoes bigint,
  item_ids text[] not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists today_actions_lookup_idx on public.today_actions (installation_id, location_id, created_at desc);
create index if not exists today_actions_row_idx on public.today_actions (installation_id, row_key, created_at desc);
alter table public.today_actions enable row level security;
