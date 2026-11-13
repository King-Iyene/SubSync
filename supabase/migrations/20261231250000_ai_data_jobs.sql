-- AI data and question jobs (additive only). Ask your data keeps each person's own questions and answers (only that person can read or delete them). The other jobs
-- (data review, cleaning proposals, duplicate judge, setup auditor) keep their results in ai_runs (encrypted), so they need no table of their own.
do $$ begin
  create table if not exists public.ai_ask_turns (
    id uuid primary key default gen_random_uuid(),
    installation_id uuid not null references public.installations (id) on delete cascade,
    -- the client account the person was looking at ('' for the whole company); history is per person, this is only a label
    location_id text not null default '',
    user_key text not null,
    question_enc text not null,
    answer_enc text not null,
    run_id uuid,
    window_from date,
    window_to date,
    created_at timestamptz not null default now()
  );
  create index if not exists ai_ask_turns_user_idx on public.ai_ask_turns (installation_id, user_key, created_at desc);
  alter table public.ai_ask_turns enable row level security;
  revoke all on public.ai_ask_turns from anon, authenticated;
end $$;
