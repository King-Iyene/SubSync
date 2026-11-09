-- Unanswered 24-hour alerts are routed to a verified account user. Additive only.
alter table public.cached_conversations
  add column if not exists assigned_to text;

alter table public.location_users
  add column if not exists role text check (role in ('account_admin', 'account_user'));

alter table public.alerts
  add column if not exists recipient_user_key text;

alter table public.notifications
  add column if not exists recipient_user_key text;

alter table public.notification_deliveries
  add column if not exists recipient_user_key text,
  add column if not exists respect_quiet_hours boolean not null default false,
  add column if not exists email_dry_run_only boolean not null default false;

create index if not exists alerts_breach24_recipient_day_idx
  on public.alerts (installation_id, recipient_user_key, created_at)
  where kind = 'breach24';

create index if not exists notifications_recipient_idx
  on public.notifications (installation_id, recipient_user_key, created_at desc)
  where recipient_user_key is not null;
