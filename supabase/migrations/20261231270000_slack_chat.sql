-- Chat with the SubSync bot in Slack (additive only; the feature is behind the slack_chat flag, default off).
-- slack_chat_links: which Slack workspace (and channel) belongs to which company or single client account, and the bot token Slack gave when an admin added the app.
-- A workspace maps to exactly ONE company (or one client account of it); channel_id '' is the workspace default (direct messages and any channel the bot is invited to).
-- slack_chat_events: every Slack event id seen (so a retry is answered once) and who asked (for the per-person rate limit). Rows older than 2 days are removed by the app.
do $$ begin
  create table if not exists public.slack_chat_links (
    id uuid primary key default gen_random_uuid(),
    installation_id uuid not null references public.installations (id) on delete cascade,
    -- null: the whole company (an agency admin linked it). A client account id: only that account can ever be asked about.
    location_id text,
    team_id text not null,
    channel_id text not null default '',
    bot_token_enc text not null,
    bot_user_id text,
    linked_by text,
    status text not null default 'connected' check (status in ('connected', 'revoked')),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (team_id, channel_id)
  );
  create index if not exists slack_chat_links_installation_idx on public.slack_chat_links (installation_id);
  alter table public.slack_chat_links enable row level security;
  revoke all on public.slack_chat_links from anon, authenticated;

  create table if not exists public.slack_chat_events (
    event_id text primary key,
    team_id text not null,
    slack_user text not null default '',
    created_at timestamptz not null default now()
  );
  create index if not exists slack_chat_events_user_idx on public.slack_chat_events (team_id, slack_user, created_at desc);
  alter table public.slack_chat_events enable row level security;
  revoke all on public.slack_chat_events from anon, authenticated;
end $$;
