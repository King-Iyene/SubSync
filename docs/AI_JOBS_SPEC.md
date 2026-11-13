# AI jobs spec (for the next builder)

Platform built in `src/lib/ai/`. Read `docs/AI_AGENTS_PLAN.md` first. Everything below is a specification: only the platform and the 7 am brief writer exist.

## How to add a job (the extension points)
1. **Registry** (`src/lib/ai/jobs.ts`): the entry already exists as `planned`. Fill `system`, `output` (text or JSON schema), `tools`, `maxTokens`, `maxToolRounds`, set `status: "live"`.
2. **Input builder** (a pure function like `briefFacts` in `src/lib/ai/brief.ts`): builds the user message on the server from ONE tenant's own rows. Returns `{ text, fields, includesNames }`. `fields` is the plain list shown in "What was sent to your AI". Names, emails, phones and message text only when `includesNames` is true; the gateway refuses that unless the account opted in.
3. **Tools** (`src/lib/ai/tools.ts`, `READ_TOOLS`): each is one of OUR read-only analytics functions with a fixed argument schema (`parse`) and a `run(tenant, args)` that receives the tenant from the verified session. The model never names a company or account. A tool returns `{ data, rowsHash, rowCount }`: numbers, the hash address of the exact list in the app, and the row count, which must equal the rows that list opens. No raw SQL, no writes. The gateway runs at most 4 tool calls per round, up to `maxToolRounds`, and the post-check treats every tool result as part of the input, so an answer may only quote numbers that tools returned.
4. **Run** with `runJob(deps, request)` (`src/lib/ai/gateway.ts`). It enforces the kill switches (global `AI_KILL_ALL`, the customer's Pause), the customer's monthly cap, the per-account rate limit, idempotency per (company, connection, job, input hash), the post-check and the run log. JSON jobs are parsed and validated against the schema (`validateJson`), then every string and number in the answer goes through the number check.
5. **Run history per person**: `ai_runs.user_key` holds who asked; `GET /api/app/ai?part=history` returns only the caller's own runs; thumbs up/down in `ai_runs.feedback`.
6. **Writes**: a job whose `approval` is `approve` returns proposals only. The person previews them and applies them through the existing Fix data tools and the safe gateway (`src/lib/ghl/crm-gateway.ts`) with typed confirmation and undo. An agent never calls a write.
7. **Tests**: golden tests with the mock provider (fixed inputs, checked outputs, number-guard rejection, opt-in gating, cap, kill switch), plus the tenant isolation test.

Common guardrails for every job below: aggregates by default; counts must equal rows; numbers come from our SQL; DND and unsubscribed contacts are never proposed for deletion or messaging; contacts with active payments, workflows, open deals or upcoming appointments are protected from merge or delete proposals; test and junk contacts are only suggested, never removed by the job.

## 1. Data review (AI audit of a client's CRM data quality)
- Who and why: agency owner or client admin; "is my data good enough to trust the numbers?"
- Input: Data health counts per check (missing phone, bad phone format, missing owner, no tag, no source, test-looking contacts, duplicate groups), the quality score and its history, per account.
- Tools: `data_health_counts(account?)`, `data_health_rows(check, page)`, `quality_history(days)`.
- Output schema: `{ summary: string (<=400), findings: [{ id, severity: "high"|"medium"|"low", title, explanation (plain words), count: integer, rowsHash: string, evidence: [string] (<=3 short examples, only with names opt-in) }] (<=8) }`.
- Guardrails: each `count` must equal the `rowCount` of the tool result it cites; `rowsHash` must be one a tool returned; a finding without one is dropped.
- Approval: suggest. Privacy: aggregates; examples with names only after opt-in. Cost class: large.

## 2. Data cleaning proposals
- Who and why: whoever owns data quality; a list of fixes they can apply in one place.
- Input: rows from the Fix data lists (phone formats, name casing, junk or test contacts, duplicates with evidence, missing owners, missing tags), a page at a time.
- Tools: `fix_rows(list, page)`, `contact_facts(contactIds[])` (opt-in only).
- Output schema: `{ proposals: [{ contactId, action: "set_phone"|"set_name"|"flag_test"|"merge_into"|"set_owner"|"add_tag", value: string, reason: string (<=160), confidence: "high"|"medium" }] (<=50) }`.
- Guardrails: `contactId` must be one the tool returned for this tenant; merge proposals carry the evidence our matcher already computed and are refused for protected contacts; nothing is applied by the job.
- Approval: approve (preview, typed confirmation naming the batch, undo, audit log). Privacy: names_optin (contact fields are the data). Cost class: small.

## 3. Ask your data
- Who and why: owner or setter types a business question ("which client had the slowest replies last week?") and gets an answer from our data.
- Tools (whitelist, read-only): `speed_summary(account?, days)`, `unanswered_summary(account?)`, `appointments_summary(account?, days)`, `deals_summary(account?)`, `payments_summary(account?)`, `team_summary(days)`, `client_list()`. Each returns numbers, `rowsHash`, `rowCount`. A client account session can only ever call them for its own account.
- Output schema: `{ answer: string (<=600), citations: [{ label, value: string, rowsHash, rowCount: integer }] (1..6), cannotAnswer: boolean }`.
- Guardrails: every number in `answer` must appear in a tool result of that conversation; every citation must match a tool result exactly; if no tool can answer, `cannotAnswer` is true and the answer says so. The UI shows each citation as a button that opens the exact rows. Questions and answers are kept per person (`ai_runs` with `user_key`) and shown only to that person.
- Approval: suggest. Privacy: aggregates; row examples only with opt-in. Cost class: large. Hardest job: build it last.

## 4. Duplicate adjudication
- Input: one candidate pair or group from the existing matcher with its evidence (same email, same phone, name similarity, dates). Output: `{ verdict: "same"|"different"|"unsure", reasons: [string] (<=3) }`. Used only for uncertain pairs; "same" still goes through the existing merge preview, typed confirmation and undo. Approval: approve. Cost class: large.

## 5. Setup auditor
- Input: the account's setup facts (workflows present, call queue workflow, calendars, pipelines, field mappings, connections). Output: `{ issues: [{ title, why, fix, severity }] (<=8) }`. Suggest only. Privacy: aggregate. Cost class: large.

## ChatGPT sign-in: what King must apply for (OpenAI plan-usage OAuth, scope `chatgpt.tokens.use.direct`)
Status: announced Sept 2026 for launch partners only. The adapter and card entry exist behind the flag `ai_chatgpt` (default OFF); the card says "Coming when OpenAI approves our app". The two OpenAI addresses in `src/lib/ai/oauth.ts` are marked CHECK: confirm them from OpenAI's partner documentation before switching it on.
Application checklist (King):
1. Find OpenAI's partner application for the plan-usage ("Sign in with ChatGPT") program and apply as a developer partner for SubSync, a CRM add-on that uses the customer's own plan allowance for short wording tasks.
2. Prepare: company name and website, a one-paragraph description of the use, the exact scope requested (`chatgpt.tokens.use.direct`), expected volume (about one short run per client account per day), screenshots of the AI card and the "What was sent to your AI" preview, a link to the privacy page (what is sent, that nothing is kept in clear), and a support email.
3. Provide the redirect URL: `https://<our app domain>/api/integrations/ai/callback` (HTTPS, our own stable domain, not a white-label domain).
4. Ask OpenAI: the confirmed authorize and token addresses, whether a client secret is issued (PKCE is built in either way), token lifetime, refresh behaviour, and the rules on model choice and rate limits.
5. When approved: set `OPENAI_OAUTH_CLIENT_ID` (and `OPENAI_OAUTH_CLIENT_SECRET` if issued) in Vercel, fix the two addresses if they differ, test with King's own account, then switch `ai_chatgpt` on.
Anthropic: no subscription sign-in is built or to be built. API key only.
