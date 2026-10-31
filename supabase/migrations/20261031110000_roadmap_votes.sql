-- Roadmap voting: one vote per person per item, scoped to the installation. Additive only.
create table if not exists roadmap_votes (
  installation_id uuid not null references installations(id) on delete cascade,
  item_key text not null,
  voter text not null,
  created_at timestamptz not null default now(),
  primary key (installation_id, item_key, voter)
);
alter table roadmap_votes enable row level security;
