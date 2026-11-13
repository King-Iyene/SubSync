# King: what the AI platform needs from you (paste into section G of docs/KING_TODO_FINAL.md)

Bring your own AI. SubSync never pays for AI, so there is NO `ANTHROPIC_API_KEY` (or any other AI key) for you to create or set. Customers connect their own.

1. Nothing to set for: pasted API keys (Anthropic, OpenAI, Google Gemini, OpenAI-compatible) and "Connect with OpenRouter". OpenRouter needs no application: its sign-in is open to any app. The server only needs `NEXT_PUBLIC_APP_URL` (already set) and `TOKEN_ENCRYPTION_KEY` (already set).
2. Switch on, in this order, after the migration is applied: `ai_byo` (the Settings card and usage panel), then `ai_brief` (the 7 am wording). Leave `ai_chatgpt` OFF.
3. Emergency stop for everyone: set the environment variable `AI_KILL_ALL=true` in Vercel and redeploy. Each customer also has a Pause switch.
4. "Sign in with ChatGPT": the exact application checklist is in docs/AI_JOBS_SPEC.md, section "ChatGPT sign-in: what King must apply for". Until OpenAI approves, the button says "Coming when OpenAI approves our app".
5. Anthropic: API key only. No subscription sign-in exists or may be built.
6. Data and question jobs (after the migration `20261231250000_ai_data_jobs.sql` is applied): switch on, each separately and only after `ai_byo`: `ai_ask_data` (Ask your data on Today and Ctrl K), `ai_data_review`, `ai_data_clean`, `ai_dup_judge`, `ai_setup_audit`. Each customer also switches the job on for their own account in Settings, Integrations, AI (off by default). Cleaning proposals and the duplicate judge send names, so they only run for an account that ticked "allow names". Nothing needs a real provider test from you except one smoke run with your own key (see the PR report).
