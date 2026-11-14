-- Call queue tags per client account. Additive only: three new tables, nothing existing is changed. Idempotent.
--   account_queue_tags     the tag name an account chose for one queue (first_reply, no_show, call_now, call_follow_up). No row means the default.
--   call_queue_checks      the last "Check that it worked" answer for one account (cached, so Getting started never calls the CRM on a page load)
--   cq_company_switch      per company: whether the optional one-click setup card may show (default off; only the platform owner switches it on)
create table if not exists public.account_queue_tags (
  installation_id uuid not null references public.installations (id) on delete cascade,
  location_id text not null,
  queue_key text not null check (queue_key in ('first_reply', 'no_show', 'call_now', 'call_follow_up')),
  tag text not null check (char_length(tag) between 1 and 60 and position(',' in tag) = 0),
  updated_by text,
  updated_at timestamptz not null default now(),
  primary key (installation_id, location_id, queue_key)
);
alter table public.account_queue_tags enable row level security;

create table if not exists public.call_queue_checks (
  installation_id uuid not null references public.installations (id) on delete cascade,
  location_id text not null,
  state text not null check (state in ('ok', 'missing', 'needs_permission')),
  lines jsonb not null default '[]'::jsonb,
  checked_at timestamptz not null default now(),
  primary key (installation_id, location_id)
);
alter table public.call_queue_checks enable row level security;

create table if not exists public.cq_company_switch (
  installation_id uuid primary key references public.installations (id) on delete cascade,
  snapshot_on boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.cq_company_switch enable row level security;
