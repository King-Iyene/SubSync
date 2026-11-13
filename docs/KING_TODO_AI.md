# King: what the AI platform needs from you (paste into section G of docs/KING_TODO_FINAL.md)

Bring your own AI. SubSync never pays for AI, so there is NO `ANTHROPIC_API_KEY` (or any other AI key) for you to create or set. Customers connect their own.

1. Nothing to set for: pasted API keys (Anthropic, OpenAI, Google Gemini, OpenAI-compatible) and "Connect with OpenRouter". OpenRouter needs no application: its sign-in is open to any app. The server only needs `NEXT_PUBLIC_APP_URL` (already set) and `TOKEN_ENCRYPTION_KEY` (already set).
2. Switch on, in this order, after the migration is applied: `ai_byo` (the Settings card and usage panel), then `ai_brief` (the 7 am wording). Leave `ai_chatgpt` OFF.
   Team and client jobs (docs/AI_AGENTS_PLAN.md section 10), after migration 20261231260000 is applied, each on top of `ai_byo` and each switched on by its own flag: `ai_report` (monthly report summary, Draft all), `ai_leads`, `ai_coach`, `ai_anomaly`, `ai_meeting`, `ai_one_thing`. Then in Settings, AI, turn each job on for the connection and choose the tone and accounts. Coaching and meeting summaries stay off until an account opts in.
3. Emergency stop for everyone: set the environment variable `AI_KILL_ALL=true` in Vercel and redeploy. Each customer also has a Pause switch.
4. "Sign in with ChatGPT": the exact application checklist is in docs/AI_JOBS_SPEC.md, section "ChatGPT sign-in: what King must apply for". Until OpenAI approves, the button says "Coming when OpenAI approves our app".
5. Anthropic: API key only. No subscription sign-in exists or may be built.
