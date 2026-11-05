# GHL API feature map (research only, 5 Nov 2026)

Labels: VERIFIED = read in a primary source this session (connector catalogue, repo docs). INFERENCE = reasoning or third-party blog. CHECK = confirm on the live API before building. BLOCKED = not reachable. Verdicts: SAFE (no sign GHL is building it), RISK (partly native, requested or planned), NATIVE (skip).

## 0. How this was checked, and what could not be read

| Source | Result |
| --- | --- |
| Connector catalogue (`search_operations`, ~35 sweeps) | VERIFIED. Catalogue is a **location-level** view: every search reports `scopeFilteredCount` 1 to 3, i.e. ops hidden from this connection. Agency, SaaS and snapshot ops never appeared, so section 3 for them is INFERENCE from public docs. At least ~390 ops visible. |
| marketplace.gohighlevel.com/docs | Not fetched (no direct need; catalogue gave scopes). |
| ideas.gohighlevel.com, ideas.leadconnectorhq.com, highlevel.canny.io (ideas board, changelog, roadmap) | **BLOCKED**: DNS does not resolve in this sandbox. Add them to the session network allow-list to finish the RISK checks. Search results show a Snapshots board with an "upcoming" filter exists but its content was unreadable. |
| netpartners.marketing, ghlexperts, other blogs | Blocked for fetch; only search snippets read. Third-party, dates unverified (INFERENCE). |
| Reddit, Facebook groups, YouTube, marketplace listings | Not reachable. No community quotes are claimed. Pain points below come from repo docs (`docs/research/*`, `docs/COMPETITORS.md`) plus snippets. |
| Repo | Read: CLAUDE.md, FEATURES.md, FEATURE_STATUS.md, SCOPES.md, MOAT.md, BLOCKED.md headings. |

GHL changes seen in snippets (INFERENCE, third-party): Feb 2026 Ask AI opens from reports with filters preloaded; May 2026 Ask AI persistent memory, Voice AI Performance Reports (Labs, emailed weekly or monthly); Jun 2026 conversation-report filters with AND/OR on status, direction, source, sender, workflow; multiple dashboards with a default; dynamic custom values in widgets; Q1 2026 agency SaaS dashboard shows sub-account activity, wallet balance and ticket volume; Jul 2026 unified client portal and AI-employee reselling tiers; official ChatGPT app. Email validation, response-time reports: nothing found.

## 1. API group table (location token unless noted)

Ops = operations matched in my sweep (not full group size). "Used" = in SubSync scopes today (docs/SCOPES.md, 29 scopes).

| Group (domain) | Token | Scopes (exact) | R/W | Ops | Used? |
| --- | --- | --- | --- | --- | --- |
| locations (get, search, tags, custom fields, custom values, templates, tasks, conv. channels) | Agency for `search-locations`; location for rest | `locations.readonly`, `locations/tags.readonly`, `locations/customFields.readonly\|write`, `locations/customValues.readonly`, `locations/templates.readonly`, `locations/tasks.readonly` | R+W | ~25 | Yes, except customValues, templates |
| contacts (CRUD, search, lookup, dup, notes, tasks, tags, campaigns, workflow, followers, appointments) | Location | `contacts.readonly`, `contacts.write` | R+W | 32 | Yes |
| conversations (search, messages, export, recording, transcription, send) | Location | `conversations.readonly`, `conversations/message.readonly`, `conversations/message.write`, `conversations.write`, `conversations/livechat.write` | R+W | 31 | Yes (read only) |
| calendars (calendars, events, appointments, slots, groups, resources, schedules, notifications, services) | Location | `calendars.readonly\|write`, `calendars/events.readonly\|write`, `calendars/groups.*`, `calendars/resources.*` | R+W | 68 | Yes (read) |
| opportunities and pipelines | Location | `opportunities.readonly\|write`, `pipelines.readonly\|write\|create` | R+W | 34 | Yes |
| users | Agency (companyId) or location | `users.readonly`, `users.write` | R+W | ~6 | Optional, yes |
| workflows (search, definition, create, status, delete) | Location | `workflows.readonly\|write\|publish\|delete\|logs` | R+W | ~12 | Yes (read) |
| campaigns (legacy) | Location | `campaigns.readonly` | R | 1 | Yes |
| emails (campaigns, templates, stats, bulk actions) | Location | `emails/campaigns.readonly\|write`, `emails/templates.readonly\|write`, `emails/stats.readonly` | R+W | ~35 | Stats yes |
| email-isv (`POST /email/verify`) | Location | `lc-email.readonly` (catalogue marks it write) | W | 1 | No |
| forms, surveys (submissions) | Location | `forms.readonly`, `surveys.readonly` | R | 12 | No |
| funnels (funnels, pages, redirects) | Location | `funnels/funnel.readonly`, `funnels/page.readonly`, `funnels/pagecount.readonly` | R+W | ~44 | No |
| payments (transactions, subscriptions, custom provider) | Location | `payments/transactions.readonly`, `payments/subscriptions.readonly`, `payments/custom-provider.write` | R+W | ~22 (with invoices) | No |
| invoices (invoices, estimates, schedules) | Location | `invoices/estimate.readonly\|write`, `invoices.readonly` | R+W | ~20 | No |
| products (products, prices, store, reviews, stats) | Location | `products.readonly\|write` | R+W | 59 | No |
| courses / memberships (enrollments, offers) | Location | `courses.readonly\|write` | R+W | ~30 | No |
| voice-ai (agents, call logs) | Location | `voice-ai-dashboard.readonly`, `voice-ai-agents.write` | R+W | 11 | No |
| agent-studio (managed agents, read only) | Location | `managed-agents.readonly` | R | 2 | No |
| phone-system (numbers, pools) | Location | `phonenumbers.read`, `numberpools.read` | R | 31 | No |
| links (trigger links) | Location | `links.readonly\|write` | R+W | ~10 | No |
| social-planner (accounts, posts, stats) | Location | `socialplanner/statistics.readonly`, `socialplanner/category.readonly`, others | R+W | 70 | No |
| ad-publishing (Facebook, LinkedIn ads, reporting) | Location | `adPublishing.readonly\|write` | R+W | many | No |
| medias | Location | `medias.readonly\|write` | R+W | 22 | No |
| blogs | Location | `blogs/post.write`, `blogs/author.readonly` | R+W | 28 | No |
| proposals (document and contract templates) | Location | `documents_contracts_template/list.readonly`, `.../sendLink.write` | R+W | 13 | No |
| objects, custom-fields, associations (custom objects) | Location | `objects/schema.readonly\|write`, `objects/record.*`, `associations.readonly`, `associations/relation.write` | R+W | ~25 | No |
| businesses | Location | `businesses.readonly\|write` | R+W | ~6 | No |
| projects (tasks and lists) | Location | `projects/tasks.readonly\|write` | R+W | ~10 | No |
| knowledge-base, chat-widget, affiliate-manager, clientportal-ai | Location | `knowledge-bases.*`, `chat-widget.write`, `affiliate-manager.readonly`, `clientportal-ai.*` | R+W | ~40 | No |
| marketplace billing (wallet charges, has-funds) | Agency or location (CHECK) | `charges.readonly`, `charges.write` | R+W | 6 | No |
| oauth (installed locations, location token) | Agency (company) | `oauth.readonly`, `oauth.write` | R+W | 2 | Yes |
| SaaS (location plans, subscriptions, rebilling) | Agency | `saas/company.read`, `saas/location.read\|write` (INFERENCE) | R+W | not visible | No, CHECK |
| snapshots (list, share link) | Agency | `snapshots.readonly` (INFERENCE) | R | not visible | No, CHECK |
| companies (agency profile), installer details | Agency | `companies.readonly`, `marketplace-installer-details.readonly` | R | not visible | Brief mentions installer details |
| reputation / reviews | n/a | none found; only `get-product-reviews` | n/a | 0 | BLOCKED for Google/FB reviews |

Token facts: VERIFIED in CLAUDE.md sections 4 and 13 that a bulk install gives a Company token plus `isBulkInstallation`, from which we mint Location tokens; a direct install gives only a Location token. API access follows the **token**, not the logged-in user: a client user, client admin and agency staff member all trigger the same server-side reads, so role limits are ours to enforce (INFERENCE, test it). Staff-to-account access comes from Users API (`roles.locationIds`, CHECK). So: agency owner/admin = Company token, all locations; agency staff = Company token filtered by their `locationIds`; client admin and client user = Location token only (client user filtered to own queue by us).

## 2. Feature ideas by group (1 to 3 each; money, moat, difficulty, feasibility, verdict)

Who pays: AG = agency owner, CL = client business. Moat = low/medium/high with reason. Diff = L/M/H.

| ID | Idea (group) | Pays | Moat | Diff | API | Verdict and evidence |
| --- | --- | --- | --- | --- | --- | --- |
| C1 | Lead-quality and dormant-contact score (contacts) | AG | Low: contact fields are public | L | VERIFIED live | RISK: smart lists and filters native. Already built. |
| C2 | Email growth tracker: weekly net-new, valid, unsubscribed/DND, source mix, list size history (contacts, emails) | AG, CL | Medium-high: platform keeps no list-size history, ours starts at install | L | CHECK (`dateAdded`, `dnd`, `source` in search body; emails stats) | SAFE: no list-growth chart seen in blogs, changelog snippets or catalogue. |
| C3 | Bulk email validation with prepaid credits (email-isv, charges) | CL, AG | Medium: per-result history, dedupe, pre-send gate | M | CHECK: `/email/verify` scope and who is billed; app wallet charge via `charges.write` | RISK: a native verify exists and is billed to the wallet (INFERENCE, not seen in changelog search). Win by agency-wide batch, credits, tag write-back, health trend. |
| C4 | Cross-account duplicate/overlap and DND-safe cleanup (contacts) | AG | Low | M | VERIFIED | RISK: dup tools native; already built, flagged off (brief: DEFER). |
| V1 | Speed-to-lead monitor and SLA breach alert (conversations messages) | AG, CL | High: first-touch history per user, cross-account | M | VERIFIED live (10 leads timed) | RISK: native workflows and a "User Replied" SLA trigger exist (brief); measurement across accounts is SAFE. Built. |
| V2 | Text delivery and A2P health: failed/undelivered rate, unregistered numbers, trend (messages status, phone-system) | AG | High: delivery history per account and number | M | CHECK (message `status` field; `phonenumbers.read` for marketplace apps) | SAFE: no cross-account view seen; carrier/A2P pain widely discussed (INFERENCE). |
| V3 | Call QA: short or missed calls, callback gap, transcript flags (recording, transcription) | AG, CL | Medium | H | CHECK (transcription needs `conversations/message.readonly`) | RISK: call reports and conversation AI summaries native. |
| K1 | True show rate, appointment hygiene, no-show recovery list (calendar events) | AG, CL | High: status-change history native lacks | M | VERIFIED (38 read live) | RISK-low: native appointment reports show counts per account; hygiene and recovery SAFE. Built. |
| K2 | Booking funnel health: calendar link works, slots exist, bookings vs new leads (calendars, free-slots) | AG | Medium | M | VERIFIED endpoints (`get-slots`) | SAFE: nothing seen. |
| O1 | Stage dwell and deal velocity from own events (opportunities) | AG, CL | High: GHL has no stage history | M | VERIFIED | SAFE (recording since 30 Oct). |
| O2 | Pipeline hygiene (no value, owner, contact) (opportunities) | AG | Low | L | VERIFIED live | RISK: pipeline views native. Built. |
| U1 | Agency user and permission audit across locations, change log of who gained admin (users) | AG | Medium: our history of role changes | L | CHECK (`users.readonly`, `roles`, `locationIds`) | SAFE: no cross-location audit seen. |
| U2 | Setter/closer leaderboard and idle detection (users, messages, events) | AG, CL | High: person-level history | M | CHECK (needs sender userId) | RISK: per-account user reports native; cross-account SAFE. Wave 2. |
| W1 | Outcome-based workflow-failure detection (workflows logs, conversations) | AG | Medium | M | CHECK (`workflows.logs`) | RISK: per-workflow error logs native; ours infers from outcomes. Built (flagged). |
| E1 | Email deliverability trend: bounce, spam, open by sending domain plus DNS (emails stats) | AG | Medium | L | VERIFIED (`get-campaign-stats`) | SAFE: per-campaign stats only natively. DNS check built. |
| F1 | Silent-failure watch: form or survey submissions drop vs own normal; funnel with zero leads (forms, surveys, funnels) | AG | Medium: baselines need history | L | VERIFIED endpoints | SAFE. |
| P1 | Money-at-risk: failed payments, past-due subscriptions, overdue invoices, expiring cards across clients (payments, invoices) | AG, CL | Medium | M | VERIFIED endpoints, CHECK fields | RISK-low: dunning workflows and invoice reminders per account native; cross-account view SAFE. |
| P2 | Source-to-revenue attribution per client (contacts attribution, opportunities, transactions, ad reporting) | AG | High if benchmarked by niche | H | CHECK (attribution fields on contacts) | RISK: GHL attribution report exists (`attributionsReportingEnabled`); AgencyAnalytics too. |
| A1 | AI receptionist QA: Voice AI call logs, failed bookings, no outcome (voice-ai, agent-studio) | AG | Medium | M | VERIFIED endpoints (`get-call-logs`) | RISK: Voice AI Performance Reports (Labs, May 2026) native per agent. Cross-account SAFE. |
| T1 | Task SLA: overdue tasks per user across accounts (locations tasks, contacts tasks) | AG, CL | Low | L | VERIFIED | RISK: tasks native per account. |
| M1 | Product/store, courses, blogs, social, media, funnels builders | n/a | Low | n/a | VERIFIED | NATIVE / crowded. Skip; read-only stats only if asked. |
| R1 | Review and reputation tracking | n/a | n/a | n/a | BLOCKED: no reviews API in catalogue | Skip until GHL exposes it. |
| X1 | Custom-object vertical dashboards (real estate listings, etc.) (objects) | CL | Medium | H | CHECK (`objects/record.*`) | SAFE. Only after a niche is proven. |
| L1 | Ask-your-data AI connector / AI daily brief (all reads) | AG | Low | M | VERIFIED (built) | RISK to NATIVE: Ask AI with memory, official ChatGPT app. Do not lead with it. |

## 3. Agency-level ideas (Company token; managing clients at scale)

| ID | Idea | API needed | Pays | Moat | Diff | Feasibility | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- |
| AG1 | Client health and churn risk across every location (built) plus subscription status | locations, our data, SaaS read | AG | High: score history | M | VERIFIED for ours; SaaS CHECK | RISK: native agency dashboard (Q1 2026) shows activity, wallet, tickets, not outcomes. |
| AG2 | SaaS margin guard: per-client price, wallet usage and rebilled revenue, "this client loses money" | `saas/*`, wallet data | AG | Medium-high: margin history | M | CHECK: marketplace charges list only this app's charges; per-location wallet read likely missing | RISK: native SaaS dashboard shows wallet balance. BLOCKED until a per-location usage endpoint is confirmed (brief Wave 3). |
| AG3 | Marketplace/plan reconciliation, install health, plan change detect | installer details, oauth installed locations | us | n/a | L | VERIFIED in brief | Internal need, not a feature. |
| AG4 | Bulk actions across locations (tag, create internal task, set custom value) with preview, confirm, undo, audit | location token per account, write scopes optional | AG | Low | M | VERIFIED endpoints | RISK: per-account bulk native. Only the cross-account preview and undo are ours. Low priority. |
| AG5 | User and permission audit plus "which staff can see which client" map | users search by `companyId` | AG | Medium | L | CHECK | SAFE. Also required by the tenancy design (staff scoping). |
| AG6 | Snapshot/setup drift: compare each client's pipelines, calendars, custom fields, values, workflow list with a golden account | readonly on those groups; snapshots list CHECK | AG | Medium-high: baselines and drift history | H | VERIFIED reads; snapshot list CHECK | RISK: Snapshots idea board has "upcoming" items I could not read; brief puts workflow inventory under DEFER. Read-only field/calendar/pipeline drift is the safer slice. |
| AG7 | New-client go-live scorecard and time-to-live benchmark (phone number, A2P, calendar, pipeline, custom values filled, email DNS) | locations, phone-system, calendars, customValues | AG | Medium: time-to-live benchmark across agencies | L | VERIFIED partly (setup checklist built), phone CHECK | SAFE. No go-live check seen natively. |
| AG8 | Client Receipts: weekly white-label proof of what we caught and fixed per client | none new | AG | High: history plus agency brand, switching cost | M | VERIFIED data exists | SAFE for the proof content; RISK for the delivery channel (unified client portal, Jul 2026). Send by email and share link, do not depend on the portal. |
| AG9 | Anonymous cross-agency benchmarks by niche (show rate, first reply, list growth) | our data, 10 accounts and 3 agencies minimum | AG | High: network effect | M | Needs installs | SAFE. |
| AG10 | Agency Health Audit lead magnet (Instant Audit run before install, via shareable link) | needs install token | AG | Low | M | CHECK (token needed) | SAFE. |

## 4. Sub-account ideas (client admin and client staff)

| ID | Idea | Who sees it | API | Verdict |
| --- | --- | --- | --- | --- |
| S1 | "My queue": unanswered leads, no-shows to rebook, hot leads untouched (built) | Client user: own queue only. Client admin: all | conversations, calendars, opportunities | RISK-low. Built. |
| S2 | Email growth tracker and list health card (C2) with "valid contacts" count | Client admin | contacts, emails stats | SAFE |
| S3 | Bulk validation with credits (C3), result shown as safe/risky/bad with tag write-back | Client admin (credits are a money action) | email-isv, charges | RISK |
| S4 | Money-at-risk list: failed card, past-due invoice, estimate not accepted (P1) | Client admin | payments, invoices | SAFE |
| S5 | Personal scorecard for a setter: speed, calls, show rate, own history only | Client user (own), admin (all) | messages, events | SAFE |
| S6 | "Is my phone/text setup healthy": A2P and delivery status in plain words (V2) | Client admin | phone-system, messages | SAFE |
| S7 | Lead source revenue: which source made money this quarter (P2) | Client admin | contacts, opps, payments | RISK |
| S8 | AI receptionist report: calls handled, bookings made, handoffs missed (A1) | Client admin | voice-ai | RISK |
| S9 | Weekly Receipt email to the business owner (AG8) | Client admin, email only | derived | SAFE |

## 5. Top 15 (money x moat x feasibility x GHL-safety; 1 = do first)

Score = money (1-5) + moat (1-5) + feasibility (1-5) + safety (1-5), max 20. New scopes are optional unless marked.

| # | Feature | Score | Verdict | Scopes needed | Note |
| --- | --- | --- | --- | --- | --- |
| 1 | Speed-to-lead and silent-failure alerts (V1) | 18 | RISK-low | `conversations.readonly`, `conversations/message.readonly`, `contacts.readonly`, `users.readonly` | Core wedge, built, needs live proof |
| 2 | True show rate, hygiene, no-show recovery (K1) | 18 | RISK-low | `calendars/events.readonly`, `calendars.readonly` | Waiting on real approval |
| 3 | Client Receipts, white-label weekly proof (AG8) | 17 | SAFE | none new | Money feature: agency shows clients value, stickiest |
| 4 | Email growth tracker and list health (C2) | 17 | SAFE | `contacts.readonly`, `emails/stats.readonly` | King wants it; cheap; history starts at install |
| 5 | Anonymous benchmarks by niche (AG9) | 16 | SAFE | none new | Strongest moat; needs 10 accounts, 3 agencies |
| 6 | Bulk email validation with credits (C3) | 15 | RISK | `lc-email.readonly` (CHECK), `charges.write`, optional `contacts.write` for tags | Check native overlap and who pays per verify before building |
| 7 | Money-at-risk across clients (P1) | 15 | SAFE | `payments/transactions.readonly`, `payments/subscriptions.readonly`, `invoices.readonly` | Direct dollars, easy pitch; three new scopes (re-approval cost) |
| 8 | Text delivery and A2P health (V2) | 15 | SAFE | `conversations/message.readonly`, `phonenumbers.read` (CHECK) | Fits the smoke-detector thesis |
| 9 | Silent-failure watch: forms, surveys, booking (F1, K2) | 15 | SAFE | `forms.readonly`, `surveys.readonly`, `calendars.readonly` | Low effort, baselines compound |
| 10 | New-client go-live scorecard (AG7) | 14 | SAFE | `locations/customValues.readonly`, `phonenumbers.read`, `calendars.readonly` | Partly built |
| 11 | Setter/closer leaderboard and coaching (U2) | 14 | RISK | `users.readonly`, messages, events, opportunities | Wave 2 |
| 12 | Agency user and permission audit (AG5, U1) | 14 | SAFE | `users.readonly` | Needed for staff scoping anyway |
| 13 | Stage dwell and deal velocity (O1) | 14 | SAFE | `opportunities.readonly` | Recording already; screen only |
| 14 | AI receptionist QA across clients (A1) | 13 | RISK | `voice-ai-dashboard.readonly` | Growing reselling trend; native reports exist per agent |
| 15 | Setup drift monitor, read-only slice (AG6) | 12 | RISK | `locations/customFields.readonly`, `locations/customValues.readonly`, `calendars.readonly`, `pipelines.readonly` | Skip workflows (brief DEFER) |

Scope load if all shipped: about 10 new optional scopes, still far below the 165 of the leading competitor. Batch them into one release (1.1.0) per CLAUDE.md section 2A; each added scope later forces re-approval.

## 6. GHL may build this soon: avoid or move fast

| Item | Signal (INFERENCE unless noted) | Advice |
| --- | --- | --- |
| AI daily brief, ask-your-data connector | Ask AI with memory, Agents opened from reports, official ChatGPT app | Avoid as a headline. Keep the connector as a free extra. |
| Generic agency KPI dashboard and client health score | Multiple dashboards, default dashboard, agency SaaS dashboard with activity, wallet, tickets | Move fast on outcome metrics (first reply, show rate) with history, not on tiles. |
| Conversation and response reports | Jun 2026 AND/OR filters on status, direction, sender, workflow | Move fast on SLA alerts and per-user history now; reports alone will be native within months. |
| Voice AI performance reports | Labs feature, emailed weekly/monthly | Only cross-account AI QA is defensible. |
| Client-facing portal and reporting | Unified client portal, AI-employee reselling tiers (Jul 2026) | Deliver Receipts by email and link; do not depend on their portal. |
| Email validation | Native verify likely (not found in changelog search) | Check before building C3; compete on batch, credits, history. |
| Snapshot sync and drift | Snapshots board has an "upcoming" filter (unreadable) | Keep drift read-only and small. |
| Workflow SLA triggers ("User Replied" timeout, brief) | Already native per brief | Never pitch detection as the differentiator; pitch independent measurement and proof. |

## 6b. Related files

Industry pain points, features per industry (sales, real estate, health, coaches, retail, home services, solar), the health read-only rules, the merged industry top 15, and the marketplace listing note (Ask AI discovery, app detail page revamp) are in `docs/research/GHL_INDUSTRY_PAIN_POINTS.md`. Canny (changelog and ideas board) was unreadable here, so every overlap verdict above stays INFERENCE until it can be re-checked.

## 7. Next checks (needs King or allow-list)

1. Allow `ideas.gohighlevel.com` and `highlevel.canny.io` in session network settings, then re-run the RISK checks (sections 2, 3, 6) against the real ideas board and changelog.
2. In a test agency, mint a Company token and call `GET /snapshots`, `GET /saas-api/public-api/locations`, `GET /users/search?companyId=`, `GET /marketplace/billing/charges` to confirm scopes and whether agency ops exist for marketplace apps.
3. Call `POST /email/verify` once on a test location and read the wallet before and after to learn who is billed.
4. Log message `status`, calendar `appointmentStatus` and contact `attributions` samples to settle the CHECK items in section 2.
