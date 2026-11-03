-- Stage F1 (numbers truth). Additive only: one new table and three new columns. Nothing is changed, renamed or removed, and the old code
-- simply does not read them, so the previous release keeps working against this database.

-- N37 and N38: how the owner classifies pipelines and stages, and the win probability the owner assumes for a stage.
-- Keyed by the pipeline and stage NAME (lower case, trimmed), so the same pipeline cloned into many client accounts is one row.
--   stage_key = ''  : a row about the pipeline itself (class in_use or not_in_use)
--   stage_key <> '' : a row about one stage (class active, closed_out or ignore; win_probability 0 to 100, the owner's own assumption)
-- No rule row means "use the suggestion made from the name"; the screen says which is in force.
create table if not exists public.stage_rules (
  installation_id uuid not null references public.installations (id) on delete cascade,
  pipeline_key text not null,
  stage_key text not null default '',
  class text check (class in ('active', 'closed_out', 'ignore', 'in_use', 'not_in_use')),
  win_probability smallint check (win_probability between 0 and 100),
  updated_at timestamptz not null default now(),
  updated_by text,
  primary key (installation_id, pipeline_key, stage_key)
);
alter table public.stage_rules enable row level security;

-- N39: which counting rule a day's snapshot was written under, so a change of definition is never drawn as a trend.
-- Null means "written before this column existed"; the code reads such rows by date (docs/METRICS.md, "Definition versions").
alter table public.account_metrics_daily add column if not exists definition_version integer;

-- N45: the tags the owner marked as cold lists (bought or scraped contacts). Null means "not chosen yet", so the suggestion from the tag names applies.
alter table public.settings add column if not exists cold_tags text[];

-- N39: counts every change to the stage rules, so changing a rule starts a new definition version for the history charts.
alter table public.settings add column if not exists deal_rules_revision integer not null default 0;
