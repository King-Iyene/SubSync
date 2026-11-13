# AI agents plan (status: BRING YOUR OWN AI platform and job 1 built, behind flags, default off)

Status (13 Nov 2026): the platform (provider gateway, safety layer, per-account connection, usage panel) and job 1, the 7 am brief writer, are built behind the flags `ai_byo`, `ai_brief` and `ai_chatgpt`, all default off. Meeting-note matching, Slack routing, dedupe and every number remain plain, tested code. AI is added only where it is clearly better than rules, and never where a rule is exact. What is built and what is next: section 8.

## 0. DECISION (King, final): bring your own AI. SubSync never pays for AI
Each customer connects THEIR OWN AI account with their own key, so there is no AI bill for SubSync and no key for King to hold. A consumer ChatGPT or Claude chat subscription has no API and cannot be used with a pasted key (the UI says so). The three ways to connect: OpenRouter sign-in (OAuth PKCE, live), Sign in with ChatGPT (OpenAI plan-usage OAuth, built but OFF until OpenAI approves our app), and a pasted API key (Anthropic, OpenAI, Google Gemini, any OpenAI-compatible service). Anthropic is API key only: Anthropic prohibits subscription login in other products, so none is built.

Background: a Claude or Anthropic SUBSCRIPTION (the one Claude Code uses) is for one person using Anthropic's apps. It cannot legally or technically power a hosted multi-tenant product. The product needs an Anthropic API key with per-tenant metering, billed per token. Claude Code subagents like the ones building SubSync are a development tool only and never run inside the product.

## 1. Where plain code stays (do NOT use AI)
Email matching of a meeting to a contact (exact email, one match, else wait), Slack routing and quiet hours, dedupe by meeting id, every count, rate, dollar and date, permission checks, undo. These are exact, free and testable. AI would only add cost and risk.

## 2. Agent jobs, ranked (money first, then effort)
| # | Job | Why it earns money | Effort | Model |
|---|---|---|---|---|
| 1 | 7am brief writer | The daily habit; numbers from SQL, words from the model | S | small |
| 2 | Monthly proof report narrator | Agencies show it to clients; retention | S | larger |
| 3 | Churn and anomaly explanations in plain words | Saves accounts | M | larger |
| 4 | SLA breach root-cause notes | Turns an alert into an action | M | small |
| 5 | Meeting summary to one line + follow-up draft | Daily use by setters | S | small |
| 6 | Duplicate adjudication for uncertain merges, with evidence | Cleaner data, fewer wrong merges | M | larger |
| 7 | Reply drafts for approval (never auto-send) | Speed to lead | M | larger |
| 8 | Setup auditor (what is misconfigured in a client account) | Onboarding, support cost | M | larger |
| 9 | Lead scoring and next-best-action | Conversion | L | small |
| 10 | Data cleaning proposals | Quality score | M | small |
| 11 | Workflow gap diagnosis | Uses the workflow snapshot | L | larger |
| 12 | Support triage for the agency | Their time | M | small |
| 13 | Onboarding assistant | Activation | M | small |
| 14 | "Ask your data" chat | Wow feature, highest risk and cost | L | larger |

## 3. Architecture
- One agent per job type. Each run is queued (a table plus the existing cron) and server-side only.
- Each run is bound to ONE verified company (and location when the job is per account). The prompt is built on the server from that tenant's rows; there is no shared context, memory or cache across tenants. Run ids and results are tenant-scoped and covered by the cross-tenant test.
- Tools: read-only rollups (our SQL) plus the safe gateway for writes. Writes always show a preview and are audit-logged and undoable.
- Approval levels per job and per tenant: (a) suggest only, (b) approve each, (c) automatic for low-risk jobs after opt-in. Default (a). Replies to leads are never automatic.
- Numbers always come from our SQL. The model writes words around numbers we pass in; a post-check rejects any output containing a number that was not in the input.
- Budgets: per-tenant monthly spend cap and per-job caps, rate limits, retries with backoff, idempotency key per (tenant, job, input hash) so a retry never bills twice.
- Quality: golden tests per job (fixed inputs, checked outputs), hallucination guards (number check, banned-claim list, length limit), a human thumbs up/down stored with the run.
- Logging (the moat): every run stores job, tenant, input fingerprint (minimised), output, token counts, cost and approval result.
- Kill switches: global (env) and per tenant (setting), checked before every run.
- Privacy: aggregates by default. Names, emails, phones and message text are sent only after a per-account opt-in, and are never stored in the run log in clear.
- Models: small model for classification and short lines, larger model for narratives. Use the current Claude model ids from the claude-api reference at build time; prompt caching on the fixed instructions to cut cost.

## 4. Packaging
Usage-based add-on through the marketplace billing meter (Create Wallet Charge API), as the master brief already allows. Rough cost per run (estimate, verify with real usage): brief 1 to 3 cents, monthly narrative 5 to 15 cents, adjudication 1 to 5 cents per case, reply draft 1 to 3 cents. Price at roughly 3 to 5 times cost so margin stays above 65 percent, with a per-tenant monthly cap shown to the customer.

## 5. Phases
1. Read-only narrators (jobs 1, 2, 5): suggestions only, no writes. Needs: `ANTHROPIC_API_KEY` (server env var only, never the browser), tables `ai_runs`, `ai_budgets`, `ai_settings`, the cron queue, the billing meter.
2. Approval-based actions (jobs 6, 7, 8, 10): preview, approve, gateway write, audit, undo.
3. Autonomous low-risk (opt-in only), then "ask your data".

## 6. What King must provide
Nothing for AI keys (customers bring their own). King only switches the flags on (docs/KING_TODO_AI.md) and, for ChatGPT sign-in, applies for OpenAI partner access (docs/AI_JOBS_SPEC.md). The older plan to resell AI through a billing meter is dropped.

## 7. Slack: what is automatic now and what needs King
Built (default off, dry run): routing rules, pause all, per-account mutes, quiet hours, send-a-test, meeting notices. Not built because it needs a different Slack permission set: one-click channel creation and direct messages need a Slack app with bot scopes (`chat:write`, `channels:manage`, `im:write`, `users:read.email`). King must add those to the Slack app and approve the install; until then the product keeps using incoming webhooks, and the meeting notice is in-app only.

## 8. What is built (BYO-AI, 13 Nov 2026) and what is next
Built, all default off: `src/lib/ai/` (providers: Anthropic Messages API, OpenAI, Google Gemini, OpenAI-compatible and OpenRouter; gateway with kill switches, per-customer monthly cap, rate limit, retry with backoff, idempotency per tenant, job and input hash, tool-call loop over a read-only whitelist; safety layer with the number check, banned claims, length limit and JSON schema validation; job registry; encrypted store). Tables `ai_connections`, `ai_runs`, `ai_oauth_pending`. Screens: Settings, Integrations, AI (connect three ways, model picker from the provider's own list, monthly limit, pause, names opt-in, per-job switch, Preview with "What was sent to your AI", thumbs, usage panel, typed disconnect). Job 1: the 7 am brief wording, in the app and in the brief email, only when the account has a connection, the job is on and the number check passes.
Next (specified in docs/AI_JOBS_SPEC.md, not built): data review, data cleaning proposals, Ask your data, duplicate adjudication, setup auditor, then the monthly proof narrator and breach root-cause notes. A scheduled per-account note (today it runs on demand through Preview) is also next.

## 9. Team and client jobs (13 Nov 2026): built behind flags, default OFF
Six suggest-only jobs on the same platform, each with its own flag on top of `ai_byo`: `ai_report` (monthly client report summary and "Draft all summaries"), `ai_leads` (what happened to each lead), `ai_coach` (coaching notes), `ai_anomaly` (why a number moved), `ai_meeting` (meeting summary and follow-up draft), `ai_one_thing` (weekly one thing to fix, also in the weekly summary email). Code: `src/lib/ai/team/` (registry `jobs.ts`, pure input builders `facts.ts`, database reads `data.ts`, runner `run.ts`, per-account choices `prefs.ts`, weekly lines `digest.ts`), routes `src/lib/api/ai-team-routes.ts`, report summary storage `src/lib/analytics/proof-summary.ts`, screens `src/app/app/views/ai-team/`. Migration `20261231260000_ai_team_jobs.sql` (additive: four summary columns on `pr_reports`, table `ai_team_prefs`).
Rules that hold for all six: numbers come from our SQL (the model only words them; the number guard rejects any figure not in the input); the agency reviews and edits every client-facing text and sends it itself (a report summary is a draft in `summary_draft`, never shown to a client until the agency chooses Use in this report, which copies it to `summary`); nothing is sent to a lead or a client and nothing is written to the CRM; a job runs only when the feature flag, the connection's own job switch and the account's own choice (Settings, AI, Team and client AI jobs) all allow it; coaching notes and meeting summaries are opt-in per account and default off; the lead stories page never sends a name, email or phone to the AI (leads are L1, L2...) and shows names only when the account opted in; no shareable public link for the lead page (print or copy only, because it lists a client's own customers); coaching is private to the person and their manager, compares a person only with the middle of their own team, needs 10 first replies in 30 days and 3 peers for a comparison, and refuses ranking or shaming wording; anomaly detection is a plain z-score of this week against the four weeks before (code), the model only offers candidate reasons and what to check; the meeting job sends the summary text only when the account opted in AND names are allowed on the connection; the "one thing" is picked in code (money first, then a fixed urgency order).
Not verified: no real provider has been called (tests use a fake provider); the prompts need a real-model pass, and the cost estimates per run are unmeasured.
