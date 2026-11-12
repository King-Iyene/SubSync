-- Settings, guides and What's new (stage ST). Additive and idempotent. Not applied automatically (King approves the production apply).
-- One small table of per-person marks kept only in SubSync: a "New" badge dismissed (news_seen), a guide read (guide_read), a page hidden from the person's own menu (module_hidden).
-- user_key is the signed-in person (kind, account limit, CRM user id), never sent by the browser. installation_id is first in the key; RLS on, no access for the browser roles.
create table if not exists public.st_user_state (
  installation_id uuid not null references public.installations (id) on delete cascade,
  user_key text not null,
  kind text not null check (kind in ('news_seen', 'guide_read', 'module_hidden')),
  item_key text not null check (char_length(item_key) <= 64),
  created_at timestamptz not null default now(),
  primary key (installation_id, user_key, kind, item_key)
);
alter table public.st_user_state enable row level security;
revoke all on public.st_user_state from anon, authenticated;
