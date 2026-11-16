-- Webhook inbox (additive). A burst of platform events (a bulk import or bulk delete: tens of thousands in hours) used to be handled inside the
-- request, so most deliveries timed out before they were even recorded. The route now writes ONE row here and answers at once; a worker drains it.
-- webhook_id is unique: a platform retry of the same event is a no-op. A processed row drops its payload (personal data) and is deleted after 3 days.
create table if not exists public.webhook_inbox (
  id bigserial primary key,
  webhook_id text not null unique,
  event_type text,
  body jsonb,
  received_at timestamptz not null default now(),
  claimed_at timestamptz,
  attempts int not null default 0,
  processed_at timestamptz,
  outcome text
);
create index if not exists webhook_inbox_pending_idx on public.webhook_inbox (id) where processed_at is null;
create index if not exists webhook_inbox_done_idx on public.webhook_inbox (processed_at) where processed_at is not null;
alter table public.webhook_inbox enable row level security;
