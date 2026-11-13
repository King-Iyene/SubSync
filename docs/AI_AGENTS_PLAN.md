# AI agents plan (status: BRING YOUR OWN AI platform, job 1 and the DATA and QUESTION jobs (section 9) and the four LEAD jobs built, behind flags, default off)

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
Lead jobs (13 Nov 2026, flags `ai_lead_summary`, `ai_call_first`, `ai_cold_reasons`, `ai_reply_draft`, each on top of `ai_byo`, all default off; code in `src/lib/ai/jobs-lead.ts`, `lead-core.ts`, `lead-run.ts`, `src/lib/api/ai-lead-routes.ts`): (1) Lead summary and next step on the lead panel; (2) Who to call first in Call mode, a rule-based ranking with the AI writing only the one-line reason; (3) Why leads go cold card in Speed to lead and Going cold, patterns from our data, AI writes the explanation and 3 fixes, every count opens its rows; (4) Reply drafts in the message box, marked AI draft, never auto-sent. All suggest only; message text only with the account opt-in; no summary or draft for a lead who asked not to be contacted.
Next (specified in docs/AI_JOBS_SPEC.md, not built): data review, data cleaning proposals, Ask your data, duplicate adjudication, setup auditor, then the monthly proof narrator and breach root-cause notes. A scheduled per-account note (today it runs on demand through Preview) is also next.

## 9. The DATA and QUESTION jobs (built, 14 Nov 2026, each behind its own flag, default off)
Flags (each also needs ai_byo): `ai_ask_data`, `ai_data_review`, `ai_data_clean`, `ai_dup_judge`, `ai_setup_audit`. Per account, the job switch in the AI card is also off until turned on. Code: `src/lib/ai/data/` (tools, one file per job), `src/lib/ai/jobs-data.ts` (the five registry entries), `src/lib/api/ai-data-routes.ts` (`/api/app/aid`), UI `ask-data.tsx` and `ai-data-cards.tsx`, migration `20261231250000_ai_data_jobs.sql` (`ai_ask_turns`, per-person history).
- **Ask your data**: 11 read-only tools wrap OUR existing queries (leads waiting, first-reply times, appointments and show rate, deals, money at risk with the deal-trust rules, duplicates, workflow health, contacts and deals with no owner, data quality, accounts). The server fixes the tenant (company, one account for client sessions, the allowed accounts for staff) and the date window (the date bar, docs/DATE_RULES.md); the model names neither. Every figure must be in a tool result (number guard); every citation must be an address a tool returned in that run, with a count equal to the rows it opens (the Rows button re-runs the same query). Questions outside the data are refused. Names are aliases ("Account 4821") unless the account opted in; the server restores real names for display. History per person, deletable with a typed confirmation.
- **Data review**: findings built from our data-quality counts; kept only when id, count and rows address match a given line and the count still equals the rows.
- **Cleaning proposals**: the model only judges candidates our scan produced; the value shown is ours; protected contacts are never proposed as tests; nothing is applied: "Check in Fix data" makes a normal Fix data preview (typed confirmation, undo, write switch, gateway).
- **Duplicate judge**: advice only; the name-mismatch rule is enforced in code (a "same" verdict for different names becomes "unsure").
- **Setup auditor**: our code writes one fact line per check; the model words the issues.
Not built (stated honestly): "stale tags" (no data source yet), assigning owners by rule (no Fix data tool sets owners), a tool loop for review, cleaning, judge and setup (their inputs are built server-side, which is cheaper and safer), and any real-provider test.
## 9. The four DEAL jobs (14 Nov 2026), built suggest-only, each behind its own flag, default off
Flags (on top of `ai_byo`): `ai_deal_health`, `ai_deal_followup`, `ai_deal_winloss`, `ai_deal_forecast`. Files: `src/lib/ai/deal-jobs.ts` (pure: registry entries, input builders, schemas, rules), `src/lib/ai/deal-jobs-run.ts` (reads rows with the Pipeline functions the screens use, so the deal-trust left-out rules are inherited), `src/lib/api/ai-deal-routes.ts` (endpoints under `/api/app/ai`), `src/app/app/views/pl3/deal-ai.tsx` (buttons), registered with one line in `jobs.ts`.
| Job | Where it shows | Numbers from | The AI writes | Gate |
|---|---|---|---|---|
| Deal health check | Health column in Pipeline lists, the deal panel, the lead panel's deal | `dealHealth` rules (badge), `dealIssues` (owner, value, appointment, activity against the step's own normal) | what is stuck, what is missing, likely reason | closed deals not judged |
| Follow-up plan | Needs attention (stuck deals) list | the stuck list (`dealList`, bucket stale), the 10 biggest, do-not-disturb people left out | channel, timing, one guide line per deal | none stuck: plain sentence |
| Win/loss review | Won and lost tab | `wonLost` and `sources` for the date bar | patterns in wins and losses | under 15 closed: "Not enough closed deals yet (x of 15 needed)", no AI call |
| Forecast in words | Forecast tab | `forecast()` (the AI never gives a forecast figure) | what could move it, what to do | under 15 closed, or nothing counted: plain sentence, no AI call |
Safety: a deal's dollars reach the AI only when the deal counts in the money figures (`dollarCounted`, the same buckets the screens use); otherwise the input says why it is not counted, never the amount. Labels D1..D10 stand in for ids, so the model never sees or invents a real id. The task for a follow-up is built by our code (title, due time) and created only through the existing deal-change preview and confirm sheet and write gateway; without permission it says "Needs permission: reconnect". Names and contact details are sent only after the account's opt-in. Gateway fix made here: the number check of JSON answers now reads numeric leaves, so "$12,000" is one number (before it was read as 12 and 0 and every dollar figure in a JSON answer was rejected).
Not verified against a real provider: output quality and cost per run (golden tests use a mock provider only).
