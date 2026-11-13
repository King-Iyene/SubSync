-- Workflow module (additive only): custom workflow triggers SubSync fires and custom workflow actions a customer's workflow calls. docs/features/WORKFLOW_MODULE.md
-- wfm_settings: per account, per block (4 triggers + 2 actions), off by default. wfm_subscriptions: where the CRM told us to send each trigger (its own address, checked on save).
-- wfm_fired: one row per trigger sent (the dedupe record, the rate-limit counter and the "last fired" figure). Holds ids only: no message text, no names.
-- wfm_action_log: one row per action call, keyed by the CRM's own ids so a retried call does nothing twice.
do $$ begin
  create table if not exists public.wfm_settings (
    installation_id uuid not null references public.installations (id) on delete cascade,
    location_id text not null,
    block_key text not null check (block_key in ('subsync_lead_unanswered', 'subsync_no_show', 'subsync_deal_stuck', 'subsync_account_quiet', 'subsync_add_to_call_queue', 'subsync_mark_outcome')),
    enabled boolean not null default false,
    threshold integer check (threshold is null or threshold between 1 and 100000),
    last_fired_at timestamptz,
    fired_total integer not null default 0,
    updated_by text,
    updated_at timestamptz not null default now(),
    primary key (installation_id, location_id, block_key)
  );
  alter table public.wfm_settings enable row level security;
  revoke all on public.wfm_settings from anon, authenticated;

  create table if not exists public.wfm_subscriptions (
    installation_id uuid not null references public.installations (id) on delete cascade,
    location_id text not null,
    trigger_key text not null,
    target_url text not null,
    workflow_id text not null default '',
    trigger_id text not null default '',
    updated_at timestamptz not null default now(),
    primary key (installation_id, location_id, trigger_key, workflow_id, trigger_id)
  );
  alter table public.wfm_subscriptions enable row level security;
  revoke all on public.wfm_subscriptions from anon, authenticated;

  create table if not exists public.wfm_fired (
    id bigint generated always as identity primary key,
    installation_id uuid not null references public.installations (id) on delete cascade,
    location_id text not null,
    trigger_key text not null,
    dedupe_key text not null,
    contact_id text,
    status text not null check (status in ('sent', 'failed')),
    http_status integer,
    at timestamptz not null default now()
  );
  create unique index if not exists wfm_fired_dedupe_idx on public.wfm_fired (installation_id, location_id, dedupe_key) where status = 'sent';
  create index if not exists wfm_fired_recent_idx on public.wfm_fired (installation_id, location_id, trigger_key, at desc);
  alter table public.wfm_fired enable row level security;
  revoke all on public.wfm_fired from anon, authenticated;

  create table if not exists public.wfm_action_log (
    id bigint generated always as identity primary key,
    installation_id uuid not null references public.installations (id) on delete cascade,
    location_id text not null,
    action_key text not null,
    idempotency_key text not null,
    contact_id text,
    result text not null,
    at timestamptz not null default now(),
    unique (installation_id, location_id, action_key, idempotency_key)
  );
  alter table public.wfm_action_log enable row level security;
  revoke all on public.wfm_action_log from anon, authenticated;
end $$;
