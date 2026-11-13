-- Bring your own AI (additive only). Each account (or the company, location_id = '') connects its OWN AI provider key. SubSync never pays for AI.
-- ai_connections: one row per (company, scope). The key is encrypted at rest (AES-256-GCM, same mechanism as tokens) and never returned to a browser; key_last4 is all that is shown.
-- ai_runs: one row per model call: counts and estimated cost always; prompt and output only encrypted (never in clear). user_key is the person who asked (null for the scheduled brief).
do $$ begin
  create table if not exists public.ai_connections (
    id uuid primary key default gen_random_uuid(),
    installation_id uuid not null references public.installations (id) on delete cascade,
    location_id text not null default '',
    provider text not null check (provider in ('openai', 'anthropic', 'gemini', 'compatible')),
    -- how it was connected: a pasted key, OpenRouter sign-in (PKCE), or ChatGPT plan sign-in (partner access, not live)
    method text not null default 'key' check (method in ('key', 'openrouter', 'chatgpt')),
    refresh_enc text,
    token_expires_at timestamptz,
    base_url text,
    key_enc text not null,
    key_last4 text not null,
    model text not null,
    status text not null default 'connected' check (status in ('connected', 'needs_attention')),
    monthly_cap_usd numeric not null default 5 check (monthly_cap_usd >= 0),
    paused boolean not null default false,
    share_names boolean not null default false,
    jobs jsonb not null default '{"brief": true}'::jsonb,
    created_by text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (installation_id, location_id)
  );
  alter table public.ai_connections enable row level security;
  revoke all on public.ai_connections from anon, authenticated;

  create table if not exists public.ai_runs (
    id uuid primary key default gen_random_uuid(),
    installation_id uuid not null references public.installations (id) on delete cascade,
    location_id text not null default '',
    user_key text,
    job text not null,
    trigger text not null default 'scheduled',
    provider text not null,
    method text not null default 'key',
    model text not null,
    idempotency_key text not null,
    input_hash text not null,
    tokens_in integer not null default 0,
    tokens_out integer not null default 0,
    est_cost_usd numeric not null default 0,
    status text not null check (status in ('ok', 'rejected', 'error')),
    reason text,
    sent_fields text[] not null default '{}',
    includes_names boolean not null default false,
    prompt_enc text,
    output_enc text,
    tool_calls integer not null default 0,
    feedback smallint check (feedback in (-1, 1)),
    created_at timestamptz not null default now()
  );
  create index if not exists ai_runs_scope_idx on public.ai_runs (installation_id, location_id, created_at desc);
  create index if not exists ai_runs_key_idx on public.ai_runs (installation_id, idempotency_key);
  alter table public.ai_runs enable row level security;
  revoke all on public.ai_runs from anon, authenticated;
  -- A sign-in in progress: the single-use state we put in the redirect and the PKCE code verifier (encrypted), valid for ten minutes, deleted when used.
  create table if not exists public.ai_oauth_pending (
    state text primary key,
    installation_id uuid not null references public.installations (id) on delete cascade,
    location_id text not null default '',
    user_key text not null,
    method text not null check (method in ('openrouter', 'chatgpt')),
    verifier_enc text not null,
    created_at timestamptz not null default now(),
    expires_at timestamptz not null
  );
  alter table public.ai_oauth_pending enable row level security;
  revoke all on public.ai_oauth_pending from anon, authenticated;
end $$;
