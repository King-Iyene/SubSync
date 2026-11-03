-- Stage E2b (save destinations and content options). Additive and idempotent: two NEW tables and two NEW columns, nothing existing is changed or removed.
-- Row level security is on for both new tables and NO policy is created, so the public (anon) and signed-in (authenticated) database roles read and write
-- nothing; those roles also lose their table privileges. Only server code, which connects with the database owner role, can use them.
-- No check constraint on the item and type columns on purpose: the code validates them, and a later field can then be added without a migration.

-- Which of a client account's own contact fields the admin chose for each thing SubSync can fill (spec 8.1). Nothing is mapped until an admin does it.
create table if not exists public.field_mappings (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null references public.installations (id) on delete cascade,
  location_id text not null,
  item text not null,
  ghl_custom_field_id text not null,
  field_name text not null,
  field_type text not null default 'text',
  enabled boolean not null default true,
  set_by text,
  set_at timestamptz not null default now()
);
create unique index if not exists field_mappings_one_idx on public.field_mappings (installation_id, location_id, item);
create index if not exists field_mappings_installation_idx on public.field_mappings (installation_id);

-- Which meeting last filled each contact field, so an older meeting never overwrites a newer value (spec 8.1 ordering rule). Ids and times only, never a value.
create table if not exists public.field_write_state (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null references public.installations (id) on delete cascade,
  location_id text not null,
  contact_id text not null,
  item text not null,
  meeting_started_at timestamptz not null,
  meeting_id uuid references public.meetings (id) on delete set null,
  written_at timestamptz not null default now()
);
create unique index if not exists field_write_state_one_idx on public.field_write_state (installation_id, location_id, contact_id, item);
create index if not exists field_write_state_installation_idx on public.field_write_state (installation_id);

-- A person's own text layout (used with the Custom layout) and whether they ever picked a layout themselves (a person who never did gets the account's default).
alter table public.meeting_note_settings add column if not exists custom_template text;
alter table public.meeting_note_settings add column if not exists preset_chosen boolean not null default false;

alter table public.field_mappings enable row level security;
alter table public.field_write_state enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on table public.field_mappings, public.field_write_state from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on table public.field_mappings, public.field_write_state from authenticated;
  end if;
end $$;
