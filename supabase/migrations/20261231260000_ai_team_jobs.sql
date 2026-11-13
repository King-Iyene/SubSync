-- AI team and client jobs (additive only). Suggest-only wording jobs on top of bring-your-own-AI: monthly client report summary, lead stories, coaching notes, anomaly reasons,
-- meeting follow-up, weekly "one thing to fix". Every number comes from our own queries; these tables only hold the agency's choices and the text the agency reviews.
do $$ begin
  -- The AI summary block of a monthly client report. `summary_draft` is what the AI wrote (never shown to a client); `summary` is the text the agency reviewed, edited and chose to use.
  alter table public.pr_reports add column if not exists summary text;
  alter table public.pr_reports add column if not exists summary_at timestamptz;
  alter table public.pr_reports add column if not exists summary_draft text;
  alter table public.pr_reports add column if not exists summary_draft_at timestamptz;

  -- The agency's choices for these jobs. location_id = '' is the company default; a row for a client account overrides it. jobs: job id -> on or off (a missing job uses its default:
  -- coaching notes and meeting summaries are opt-in and default off). lead_names: show lead names on the lead stories page (never sent to the AI). tone: plain, warm or formal (company row).
  create table if not exists public.ai_team_prefs (
    installation_id uuid not null references public.installations (id) on delete cascade,
    location_id text not null default '',
    jobs jsonb not null default '{}'::jsonb,
    lead_names boolean,
    tone text check (tone in ('plain', 'warm', 'formal')),
    updated_by text,
    updated_at timestamptz not null default now(),
    primary key (installation_id, location_id)
  );
  alter table public.ai_team_prefs enable row level security;
  revoke all on public.ai_team_prefs from anon, authenticated;
end $$;
