# AI agents plan (a plan only: nothing here is built)

Status: PLAN. No AI call exists in the product today. Meeting-note matching, Slack routing, dedupe and every number are plain, tested code (`src/lib/connections/auto-note.ts`, `slack-auto.ts`, `meeting-plan.ts`). AI is added only where it is clearly better than rules, and never where a rule is exact.

## 0. The answer to "can our Claude subscription tokens power the product?"
No. A Claude or Anthropic SUBSCRIPTION (the one Claude Code uses) is for one person using Anthropic's apps. It cannot legally or technically power a hosted multi-tenant product. The product needs an Anthropic API key with per-tenant metering, billed per token. Claude Code subagents like the ones building SubSync are a development tool only and never run inside the product.

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
The Anthropic API key and a monthly spend limit set in the Anthropic console; the decision on the price per run; confirmation that the billing meter is created in the marketplace portal.

## 7. Slack: what is automatic now and what needs King
Built (default off, dry run): routing rules, pause all, per-account mutes, quiet hours, send-a-test, meeting notices. Not built because it needs a different Slack permission set: one-click channel creation and direct messages need a Slack app with bot scopes (`chat:write`, `channels:manage`, `im:write`, `users:read.email`). King must add those to the Slack app and approve the install; until then the product keeps using incoming webhooks, and the meeting notice is in-app only.
