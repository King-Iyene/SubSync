-- Personal access keys for the read-only AI connector (MCP). Only a SHA-256 hash of each key is
-- stored; the key itself is shown once at creation and cannot be recovered.

create table public.api_keys (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null references public.installations (id) on delete cascade,
  name text not null,
  key_prefix text not null,
  key_hash text not null unique,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
create index api_keys_installation_idx on public.api_keys (installation_id) where revoked_at is null;

alter table public.api_keys enable row level security;
revoke all on public.api_keys from anon, authenticated;
