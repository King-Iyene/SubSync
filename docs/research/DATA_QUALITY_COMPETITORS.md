# Data quality, dedupe and enrichment apps: what to learn (research only, 4 Nov 2026)

Labels: VERIFIED = read in a source; INFERENCE = my reasoning; CHECK = confirm live before building.
**Not readable from the sandbox** (host did not resolve): therevopsreport, getclientell, dropcontact, datagroomr.com, koalify.io, trydataclean, landbase, vendor sites, G2/Capterra pages (only search snippets seen). Most claims below are INFERENCE from vendor-authored roundups and general product knowledge. Complaints are thin and vendor-biased: treat as directional.

## 1. Apps

| App | CRM | What it does | Price signal | Strengths | Top complaints |
|---|---|---|---|---|---|
| DemandTools (Validity) | SF | Dedupe, mass update, import, verify, backup | VERIFIED: ~$132/seat/yr "complete" (per a rival's blog) | Power, flexibility, speed | INFERENCE: complex, cost grows per seat |
| Cloudingo | SF | Dedupe, scheduling, import dedupe | VERIFIED (3rd party est.): ~$2.5k / $6k / $10k+ per year, tied to record count | Scheduled jobs, high-volume syncs | Dedupe only in paid tier; per-record pricing; dated UI (INFERENCE) |
| DataGroomr | SF | ML-assisted dedupe, one-click merge, standardize | VERIFIED: priced per DataGroomr user, not SF seat | Ease, learns from past merge choices | Only vendor-written praise found |
| Plauti Deduplicate / Duplicate Check | SF | Native in SF, real-time block on entry, scenarios | Opaque (VERIFIED, rival's claim) | Native, entry-time prevention | Opaque price, setup effort (INFERENCE) |
| Clientell, Verum, DupeCatcher | SF | AI-assist and lighter dedupe | not read | n/a | not read |
| Insycle | HS, SF, Pipedrive | Dedupe, bulk edit, standardize, templates, scheduled tasks | VERIFIED snippet: ~$63/mo at 50k records (one page; conflicting) | Broadest bulk cleanup | Takes you out of the CRM into its own UI (VERIFIED snippet) |
| Dedupely | HS, SF, others | Auto-merge, rules, scheduled | Conflicting: $19/mo vs G2 Basic $80/mo | Fast start; user found 900+ dupes | Unclear pricing; limited rule depth (INFERENCE) |
| Koalify | HS | Custom match rules on any property | ~$99/mo (low-quality source) | Flexible rules (VERIFIED snippet) | Reseller-sourced praise |
| DataClean | HS | Fuzzy + phonetic, review screen | Free to 1,000 contacts (developer's own claim) | Fuzzy names | Single self-reported source |
| HubSpot native (Data Hub) | HS | Merge, suggested dupes, data quality tools | In plan | Built in | INFERENCE: limited rules; pair-by-pair review |
| Openprise, RingLead, Syncari, Census, ZoomInfo/Clearbit | Multi | Enterprise hygiene, routing, enrichment, sync | Quote-based (INFERENCE) | Depth | Overkill and costly for small agencies (INFERENCE) |
| **GHL native** | GHL | Manage Duplicates (email/phone/name), merge up to 10, "Allow duplicate" setting, Merge workflow action | In plan | Real merge moves conversations, deals, notes | Merge permanent; admin only (VERIFIED, `docs/features/DUPLICATES.md`) |
| GHL marketplace dedupe apps | GHL | Web search found only tutorials, no app (VERIFIED, limited) | n/a | n/a | CHECK in marketplace UI |

Pain points across sources (VERIFIED where a source says it, else INFERENCE): false merges, merge cannot be undone, per-record or per-seat pricing growth, no scheduling in cheap tiers, no prevention at entry, tools that pull you out of the CRM, opaque pricing.

## 2. Capability matrix

GHL column: checked with the connector's operation search on 4 Nov 2026 (no calls executed, no live data).

| Capability | Who has it | GHL API | In SubSync? | Verdict |
|---|---|---|---|---|
| Fuzzy/matching rules, confidence | All | Read all via `POST /contacts/search` (`contacts.readonly`), match ourselves. VERIFIED | Yes (grouping, "clearly differ" split) | BUILD (add confidence and rule picker) |
| Contact merge (real) | All | **No merge endpoint** (search for "merge" finds none). VERIFIED. Native merge in UI only | Guided hand-off to native screen | BLOCKED for one-click; keep guided |
| Field-level survivorship preview | DemandTools, Insycle | Preview is ours; write via `PUT /contacts/{id}` (`contacts.write`). VERIFIED | Best-record pick yes | BUILD for field fill only |
| Undo / merge history | Few | Field edits reversible from stored before-values. Delete not (re-create gets a new id). VERIFIED/INFERENCE | Undo for SubSync-only marks | BUILD (undo window on edits) |
| Scheduled scans | Cloudingo, Insycle, Dedupely | Our cron plus search. VERIFIED | Daily sync yes | BUILD |
| Real-time prevention at entry | Plauti, Cloudingo | Webhooks ContactCreate/Update arrive (seen live, `docs/CAPABILITIES.md`). Cannot block a write; detect after. `GET /contacts/search/duplicate` and upsert follow the account's "Allow Duplicate" setting. VERIFIED | Ingest only | PROPOSAL: firewall alert, not a block |
| Bulk find-and-replace with preview | DemandTools, Insycle | `PUT /contacts/{id}` one at a time; bulk exists only for tags (`POST /contacts/bulk/tags/update/{type}`) and business link (`/contacts/bulk/business`). VERIFIED. Rate limits CHECK | Cleanup (phone, tags) built, hidden | BUILD (revive safely) |
| Standardize phone/email/name/state/country | Insycle, DemandTools | Compute ourselves, write via update. VERIFIED | Phone and tag tidy; invalid email/phone detection | BUILD |
| Email/phone validation | ZoomInfo-style | Syntax local; deliverability needs paid third party. INFERENCE | Syntax yes | BUILD syntax; SKIP deliverability |
| Junk/test record detection | Few | Local rules on name, source, tags. VERIFIED | Yes (spam/test rules, junk control) | BUILD (surface as a list) |
| Orphan/stale finder | Insycle, DemandTools | Contacts search plus `opportunities.readonly`. VERIFIED | Partly (going cold, deals with no contact) | BUILD |
| Relationship hygiene | HS tools | `/contacts/business/{id}`, bulk business link (`businesses.write`). A deal's contact cannot be changed. VERIFIED | Deals without contact yes | PROPOSAL |
| Enrichment | ZoomInfo, Clearbit | Needs third-party data. Contact custom-field create API is Custom Objects/Company only (VERIFIED), so fields must pre-exist | No | SKIP (cost, privacy) |
| Health score and trend | Rare | Computed from our data | Engagement score, not data health | BUILD (see 3) |
| Rules library | Koalify, Insycle | Ours | No | PROPOSAL |
| Sandbox / dry-run | Insycle, DemandTools | Ours (preview before write) | Preview plus live-write switch | BUILD (existing pattern) |
| Reports, alerts when quality drops | Rare | Alert engine exists | No data-quality alert | BUILD |
| Audit trail | Few | Our table | Yes | Reuse |
| Backup/restore | DemandTools, HS backup apps | Read all and restore via update/create (new ids on re-create). CHECK storage and privacy | No (must delete on uninstall) | PROPOSAL (snapshot only fields we change) |
| DND/payment/deal/appointment protection | Rare | Contact fields; appointments read via `/contacts/{id}/appointments`. VERIFIED | Yes (guardrails) | Reuse |

Scopes: writes `contacts.write` (already optional, `docs/SCOPES.md`); reads `contacts.readonly`, `opportunities.readonly`, `locations/customFields.readonly`. `businesses.write` only for business link or dedupe. No other new scope.

## 3. Top 8 features, ranked by money potential

| # | Feature | Why they pay | Scopes | Risk | Simplest first version |
|---|---|---|---|---|---|
| 1 | **Data health score per client account, trend and weekly proof** | Agency shows clients "your CRM is 82% clean, up 6 points"; fits the Receipts thesis | read only | Score must be explainable | 5 checks (dupes, invalid phone/email, no owner, junk, stale) as one number; one weekly digest line |
| 2 | **Quality firewall alert** | A bad import or form floods records; agency hears first | read (ContactCreate webhook) | Webhook delay; cannot block | Alert when more than N new contacts in 1 hour are dupes, invalid or test; name the source |
| 3 | **Guided duplicate review (improve existing)** | Saves hours per client vs native 10-at-a-time | read | Already built; add confidence | Show "why matched" and a match-rule toggle (email / phone / name) |
| 4 | **Safe bulk fix with preview and undo window** | Insycle-style cleanup in the app, no CSV | `contacts.write` (optional) | Rate limits, wrong edits | Phone format and name case only; preview, confirm, 24h undo from stored before-values, caps per run |
| 5 | **Junk and test record sweep** | Cleaner pipelines, fewer wasted sends | read; write for tag only | False positives | List only, one-tap "tag as junk" (never delete) |
| 6 | **Orphan/stale contact finder** | Cleaner lists, lower per-contact cost | read | Overlaps GHL smart lists | Contacts with no owner, no activity 12 months, no deal |
| 7 | **Weekly hygiene digest** | Push, not pull; fits wedge | read | Needs email dispatcher | Weekly: new dupes, invalid, unowned, trend |
| 8 | **Import guard report** | Explains which source made the mess | read | Source field quality varies | Group new bad records by source, tag and day |

Money logic (INFERENCE): features 1, 2, 7 are read only, so they justify the paid per-account plan with no new scope. Writes (4) are the upsell and the support risk.

## 4. Three ideas nobody seems to have (INFERENCE: not found in the tools above)

1. **Health score as a client-facing receipt.** Per-account number, weekly trend, "what we found and fixed". Dedupe tools sell a one-off clean; this sells proof every week.
2. **Quality firewall for lead sources.** Alert within minutes when a form, import or integration starts creating dupes or junk, naming the source. Plauti-style tools block inside their own CRM; GHL cannot be blocked from outside, but it can be watched.
3. **Undo window on every bulk change.** Keep before-values 7 days, one button restores. Competitors mostly offer none. Applies to field edits and tags only; say plainly that merge and delete cannot be undone.

## 5. Honest limits

- No real merge call: never promise one-click merge. The guided hand-off stays the product.
- No bulk field-update endpoint: bulk edits are N calls; throttle, cap per run, idempotent.
- Cannot block creation: only detect and alert.
- Enrichment skipped: paid third-party data and consent review.
- Nothing here is tested on live data. CHECK rate limits, paging past 20k contacts, and whether DND survives an update call.
- Safety rules unchanged: DND/unsubscribed never deleted or messaged; contacts with active payments, workflows, open deals or upcoming appointments excluded from bulk deletes and merges; our own writes tagged and excluded from our metrics.
