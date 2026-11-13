-- Fast sync: one row per account and kind records how far the last good read got (the watermark), when the last full pass was, when the account was last checked and when
-- something last actually changed. Additive only. The server reads and writes it; nothing in a browser can.
create table if not exists public.sync_watermarks (
  installation_id uuid not null references public.installations(id) on delete cascade,
  location_id text not null,
  kind text not null,
  watermark timestamptz,
  last_full_at timestamptz,
  last_checked_at timestamptz,
  last_changed_at timestamptz,
  primary key (installation_id, location_id, kind)
);
alter table public.sync_watermarks enable row level security;
create index if not exists sync_watermarks_changed_idx on public.sync_watermarks (installation_id, last_changed_at desc);
