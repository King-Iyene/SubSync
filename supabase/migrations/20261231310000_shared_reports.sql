-- Share a report: a read-only link to ONE frozen snapshot of a report screen (Today, the weekly client reports, and any screen that offers "Share report").
-- The id is a long random token (192 bits), the link expires (1, 7, 14 or 30 days), the owner can switch it off, and the payload holds only the figures the screen
-- showed, with contact names and other client account names replaced unless the owner chose to include them. Additive only.
create table if not exists public.shared_reports (
  id text primary key,
  installation_id uuid not null references public.installations (id) on delete cascade,
  kind text not null,
  title text not null,
  payload jsonb not null,
  include_names boolean not null default false,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  views int not null default 0,
  last_viewed_at timestamptz
);
create index if not exists shared_reports_installation_idx on public.shared_reports (installation_id, created_at desc);
alter table public.shared_reports enable row level security;
