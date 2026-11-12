# DATAQUALITY_R1: Duplicates, data quality and intake quality (research, 11 Nov 2026)

Labels: VERIFIED = read in primary source (link). INFERENCE = my reasoning. UNVERIFIED = secondary/blog/vendor claim or not confirmed.
Primary platform sources: official OpenAPI files at github.com/GoHighLevel/highlevel-api-docs/tree/main/apps (contacts.json, forms.json, surveys.json, funnels.json, locations.json, opportunities.json), `docs/oauth/Scopes.md`, marketplace.gohighlevel.com/docs/other/rate-limits, marketplace.gohighlevel.com/docs/tags/webhook-events. In this file the platform is named in full; UI copy must say "your CRM".

## (a) How the market does duplicates and data quality

**Salesforce** (VERIFIED, help.salesforce.com "Things to Know About Duplicate Rules", "Customize Duplicate Rules", via search excerpts; page fetch blocked)
- Two parts: matching rule (which fields, exact or fuzzy) + duplicate rule (what to do). Up to 3 matching rules per duplicate rule.
- Actions on create and on edit: Allow with alert, Block, plus Report (record joins a duplicate record set, up to 100 per run). Standard default = alert + allow, report.
- Rule order matters: Block rules before Allow rules. Fuzzy on name, exact on email is the standard pattern (NPSP example).
- Real-time prevention is bypassed by API/Data Loader unless "alert via API" is enabled (UNVERIFIED, third-party blog). Cross-object: lead vs contact rules exist (VERIFIED title only).
- Duplicate jobs (scheduled scans) and merge of up to 3 records with field-level pick of survivor values: INFERENCE (well known, not re-read this session).

**HubSpot** (VERIFIED, knowledge.hubspot.com/records/manage-duplicate-records and /reports/data-quality-command-center)
- Auto-dedupes contacts by email and companies by primary domain (VERIFIED via search of KB; imports with email matching several records fail the row).
- Daily comparison scan; default contact fields: first/last name, email, IP country, phone, zip, company; similarity score you can filter (30%+). Custom rules: 2 per object, up to 9 properties (Data Hub Pro/Ent).
- Merge UX: pairs, choose surviving record and per-property value; bulk survivorship by engagement/created/updated; custom merge rules (up to 20 property overrides).
- Merges are permanent ("Merged records cannot be reverted"); only a rejected pair can be rolled back within 14 days. Audit log exports merge history (Data Hub Pro/Ent).
- Display caps: 10,000 pairs individual, 30,000 / 100,000 bulk. Gated to Professional/Enterprise tiers (individual) and Data Hub Pro/Ent (bulk, custom rules, audit).
- Data quality command center: overview of duplicate, formatting and enrichment issues; formatting fixes by property (e.g. LORELAI -> Lorelai) accept/reject; automation only Data Hub Pro/Ent; alert when duplicates exceed a daily limit. Updates via API/import are typically not re-flagged (gap).

**Keap** (UNVERIFIED mostly; help.keap.com redirects, blogs): manual pair review or auto-merge (no review); matching by email and name; merge does not carry Appointments or Deals; undo not documented.
**ActiveCampaign** (UNVERIFIED, help article 403): email is the unique key so same-email duplicates are blocked at entry; manual merge of 2 contacts only; no bulk merge; no undo (forum); emails the team on possible duplicates.
**Zoho CRM** (UNVERIFIED, search excerpts of help.zoho.com): Find & Merge per record (up to 3 records, criteria on up to 6 fields); module-wide De-duplicate tool auto-merges exact matches (e.g. email+company).
**Pipedrive** (partly VERIFIED, support.pipedrive.com): Merge Duplicates on all plans, same rules as import (same name + phone or email or org); exact-match, no bulk merge, irreversible; fuzzy/bulk via Insycle/Dedupely.
**Native CRM platform (this app's host)** (VERIFIED, help article "How to Manage and Merge Duplicate Contacts", help.gohighlevel.com "Allow Duplicate Contact")
- Manage Duplicates: admin only; pick ONE "Find by": email, phone or name; groups shown, side-by-side conflicts, choose master, up to 10 records per merge. Rejecting a match is permanent. Merge cannot be reversed.
- Merge moves tasks, opportunities, notes, products; custom fields only fill blanks on master; appointments, payments, orders, invoices default to master's.
- Allow Duplicate Contact toggle applies only to forms, Zapier, FB/IG Messenger; match by email then optional phone; CSV import always merges on phone/email. No fuzzy, no scheduled scan, no score, no trend, no cross-account view, no history we can read. Location settings `allowDuplicateContact`, `allowDuplicateOpportunity`, `allowFacebookNameMerge` are readable via GET /locations/{id} (VERIFIED, locations.json SettingsSchema).

**Specialists**
| Tool | Matching | Merge UX / undo | Prevention / schedule | Price |
|---|---|---|---|---|
| Dedupely (VERIFIED dedupe.ly/pricing) | exact, similar, fuzzy, nickname, domain root, cross-field, auto-match | preview, rules, auto-merge; undo 30 days | n/a | $40/mo (30k records) to $2,000/mo (20M); unlimited users. No CRM-platform support listed |
| Insycle (VERIFIED insycle.com/pricing) | exact/similar/fuzzy, multi-rule | bulk, master rules, field retention, preview; undo not stated; audit trail CSV | recurring tasks, workflow-triggered | $100-$200/mo per 100k records, Enterprise custom; HubSpot, Salesforce, Pipedrive, others; no CRM-platform support |
| Cloudingo (UNVERIFIED) | exact+fuzzy, Salesforce | merge, scheduled jobs | schedule | $2,500/yr Std to $10,000/yr (sources conflict, also $12/user/mo) |
| DemandTools (UNVERIFIED) | Salesforce | mass merge | scheduled | ~$3,000/yr or ~$10/user/mo (sources conflict) |
| RingLead / ZoomInfo Enrich (UNVERIFIED) | fuzzy, cross-object, enrichment | n/a | real-time prevention | from ~$25,000/yr |
| Openprise (UNVERIFIED) | AI fuzzy over all fields, configurable merge logic | auto, no manual | rules automation | not published, premium |

**Standardisation, enrichment, decay** (INFERENCE unless noted): E.164 phone normalisation (libphonenumber is the standard library), name casing, email syntax + MX + disposable-domain list, address parsing are done by Insycle (60+ transform functions, VERIFIED), HubSpot formatting fixes (VERIFIED), RingLead/Openprise. Enrichment and stale-data decay are enterprise/ZoomInfo territory; no agency-priced tool does them. Completeness score and duplicate rate dashboards exist only in HubSpot's command center (VERIFIED, Ops/Data Hub Pro+).

**What we copy / what we skip**
| Copy | Skip |
|---|---|
| Confidence tiers (exact email/phone = high, normalised phone + similar name = medium, name only = low) like HubSpot score | Auto-merge without review (Keap, Zoho): irreversible and destroys trust |
| Side-by-side survivorship with per-field pick, primary record rule, preview | Enrichment, address validation, AI fuzzy over all fields (cost, privacy, off-wedge) |
| Daily scheduled scan + alert above a threshold (HubSpot) | Building our own merge engine if no API exists (see b) |
| Reject pair, never show again (platform and HubSpot) | Enterprise RingLead-style routing |
| Undo window (Dedupely 30 days) = we keep a before-snapshot in our event store | Per-user pricing; price per client account |
| Formatting fixes as accept/reject list (HubSpot) | Rewriting data in bulk unprompted |

## (b) What the platform API gives and lacks (base https://services.leadconnectorhq.com, header Version)

| Data item | Endpoint | Scope | Available | Notes | Label |
|---|---|---|---|---|---|
| Find one existing contact by email/phone | GET /contacts/search/duplicate (locationId required; `number`, `email`) | contacts.readonly | Yes, but single lookup | Honors location setting: if Allow Duplicate off uses global unique id; else email first, phone second. Response schema not documented in spec (200 has no body schema). NOT a scan | VERIFIED |
| Whole-account duplicate scan | none | n/a | No | We must page contacts and match ourselves | VERIFIED (absent from contacts.json) |
| Merge contacts | none | n/a | **No** | No merge/combine path in contacts.json (searched whole spec for "merge": zero path hits; users/locations only unrelated words). Feature request "Contact merge webhook / API" open since 23 Dec 2022, 24 votes, no status. A "Merge Contact" workflow action is UNVERIFIED | VERIFIED (spec) / UNVERIFIED (workflow action) |
| Contact list / search | POST /contacts/search; GET /contacts/ (deprecated, startAfterId) | contacts.readonly | Yes | Search schema returns id, email, source, dateAdded, tags, customFields, attributions[], followers, etc. | VERIFIED |
| Contact detail incl. attribution | GET /contacts/{contactId} | contacts.readonly | Yes | `source`, `attributionSource` (first) and `lastAttributionSource` objects: url, campaign, utmSource, utmMedium, utmContent, referrer, campaignId, fbclid, gclid, msclikid, dclid, fbc, fbp, userAgent, ip, medium, mediumId; also visitorId, dnd, lastActivity | VERIFIED |
| Update / delete / upsert contact | PUT/DELETE /contacts/{id}; POST /contacts/upsert | contacts.write | Yes | Upsert obeys Allow Duplicate setting; body has `createNewIfDuplicateAllowed`. Delete is our only destructive "merge" building block: unsafe (would lose history) | VERIFIED |
| Tags, notes, tasks on contact | POST/DELETE /contacts/{id}/tags, /notes, /tasks | contacts.write | Yes | Safe write path for a "Possible duplicate" tag or note (must be excluded from our own metrics per rule 14) | VERIFIED |
| Dup settings per account | GET /locations/{locationId} -> settings.allowDuplicateContact, allowDuplicateOpportunity, allowFacebookNameMerge | locations.readonly | Yes (read); the "find by email/phone" priority is NOT in the schema | Tells us if an account lets duplicates in | VERIFIED |
| Forms list | GET /forms/ (locationId, skip, limit) | forms.readonly | Yes | id, name, locationId | VERIFIED |
| Form submissions | GET /forms/submissions (page, limit max 100, formId, q, startAt, endAt) | forms.readonly | Yes | Default window = last month. Fields: id, contactId, createdAt, formId, name, email, others{eventData{source, medium, mediumId, adSource, referrer, fbc, fbp, domain, page{url,title}, pageVisitType, fingerprint, timestamp, contactSessionIds}, custom fields} | VERIFIED |
| Surveys list / submissions | GET /surveys/, GET /surveys/submissions (same params, surveyId) | surveys.readonly | Yes | Same shape as forms | VERIFIED |
| Funnels | GET /funnels/funnel/list (type, category, limit, offset, name); GET /funnels/page; GET /funnels/page/count | funnels/funnel.readonly, funnels/page.readonly, funnels/pagecount.readonly (Scopes.md; OpenAPI shows Location-Access only) | Yes: structure only | List returns steps, urls, type, tracking code flags. Page = id, funnelId, name, stepId, updatedAt | VERIFIED |
| Funnel analytics (views, opt-ins, conversion) | none | n/a | **No** | Analytics exist in the UI; API requests open since 2023 (37 votes; staff reply Feb 2026 "evaluating") | VERIFIED |
| Form/page view counts | none | n/a | No | Cannot compute form conversion rate (views to submits). Only submissions and funnel structure | VERIFIED |
| Opportunity source | GET /opportunities/search | opportunities.readonly | Yes | `source` (free text), contactId, status, monetaryValue, lastStatusChangeAt, lastStageChangeAt | VERIFIED |
| Appointments | GET /calendars/events; GET /contacts/{id}/appointments | calendars/events.readonly; contacts.readonly | Yes | appointmentStatus values CHECK live | VERIFIED |
| Webhooks | see list below | per app | Yes | Retries up to 12x on non-2xx; stops on 2xx | VERIFIED |

**Webhook events that exist** (VERIFIED, 70-event list at /docs/tags/webhook-events): ContactCreate, ContactUpdate, ContactDelete, ContactDndUpdate, ContactTagUpdate, NoteCreate/Update/Delete, TaskCreate/Complete/Delete, OpportunityCreate/Update/Delete/StageUpdate/StatusUpdate/AssignedToUpdate/MonetaryValueUpdate, AppointmentCreate/Update/Delete, InboundMessage, OutboundMessage, ConversationUpdate, ConversationUnreadWebhook, UserCreate/Update/Delete, LocationCreate/Update, AppInstall, AppUninstall, AppUpdate, PlanChange, VoiceAiCallEnd, others.
**Do NOT exist:** ContactDuplicate, ContactMerge, FormSubmission, SurveySubmission, funnel page view or opt-in events (VERIFIED absent). So form intake must be polled (GET /forms/submissions every N minutes, or reconcile from ContactCreate + `attributionSource`). A merge shows up only indirectly (ContactDelete of the loser plus ContactUpdate of the master): INFERENCE, CHECK on a live merge. ContactUpdate payload documented without attribution/merge fields (VERIFIED), so enrich by GET /contacts/{id}.

**Rate limits** (VERIFIED, marketplace.gohighlevel.com/docs/other/rate-limits): burst 100 requests / 10 s, daily 200,000 / 24 h, counted per app per resource (one location or company); installing on more accounts does not split quota. Fixed (non-sliding) windows. Headers X-RateLimit-Max, X-RateLimit-Remaining, X-RateLimit-Interval-Milliseconds, X-RateLimit-Limit-Daily, X-RateLimit-Daily-Remaining, X-RateLimit-Daily-Reset (a duration in ms). 429 has no Retry-After: wait 10 s (burst) or Daily-Reset ms. Custom limits may apply.
Scale note (INFERENCE): a 20,000-contact account scanned at search page size 100 = 200 calls = ~20 s at full burst; fine nightly, never per-request.

## (c) Customer pain (evidence)
- Duplicate leads from many entry points: forms, Zapier, chat, FB lead forms, imports each create contacts; Allow Duplicate only governs forms/Zapier/Messenger; a changed email or phone defeats matching (VERIFIED for the setting behavior; causes are UNVERIFIED consultancy blogs, e.g. consultevo.com, 4spotconsulting.com, socinova.com thread "Why are leads duplicated in pipeline").
- Double-texting/double-calling: a second record triggers its own workflow, so the same person is contacted twice (UNVERIFIED, consultevo).
- Double-booking: feature request "Prevent Double-Booking" (ideas.gohighlevel.com/scheduling-calendar/p/prevent-double-booking) reports two people can book the same slot at once (UNVERIFIED snippet; race condition INFERENCE). Calendar/Google sync is a separate problem, not a contact-duplicate problem.
- Spam/bot form submissions: ideas.gohighlevel.com/forms/p/spammers-accessing-forms (VERIFIED, posted 9 Jun 2023, 19 votes, no status): agency stopped using forms; comment says built-in captcha "does not stop form spam submissions at all". Platform help article warns fake contacts raise costs and fires automations (VERIFIED); recommends captcha + email/phone validation (optional, off by default).
- Bad numbers waste dialer time and can flag carrier pools (UNVERIFIED, Kixie blog). OTP phone check before submit is a lead-form vendor suggestion (UNVERIFIED).
- Test contacts left in accounts distort every metric (INFERENCE; matches CLAUDE.md 13A "hide test accounts").
- Reddit and Facebook-group threads: NOT reachable (reddit.com blocked for the search tool; groups are private). UNVERIFIED. Action for King: 5 owner interviews, ask "how many duplicate contacts did you merge last month, and did a client get texted twice?"

## (d) The moat (INFERENCE, all of it)
- The platform has no merge history, no merge webhook, no funnel analytics and no duplicate trend. Anything we record ourselves cannot be rebuilt later.
- Append-only events to record from day one: `duplicate_found` (pair, rule, tier, score), `duplicate_ignored`, `duplicate_merged_in_crm` (detected via ContactDelete + master update, with before-snapshot of both records for our own "undo/audit"), `quality_scored` (per account per day: duplicate rate, % missing email/phone, % invalid phone, % disposable email, % test contacts), `intake_event` (submission id, form/survey/funnel, source, utm, gclid, contact id, was_duplicate, was_junk).
- Intake source quality by form/source/funnel joined to outcomes we already hold: junk rate, duplicate rate, unanswered rate, no-show rate, closed-won revenue. This answers "which form/source brings junk" without funnel analytics, which no one else has from the API.
- Cross-account patterns later (after enough accounts, anonymised, opt-in): benchmark duplicate rate and junk rate by industry; the same form template failing across clients; spam waves hitting many accounts at once.

## Design implications for SubSync (max 12)
1. Read-only detection is the product; merging stays in the CRM (no merge API). We deliver a ranked "Merge these" queue with a deep link to the native Manage Duplicates/Merge screen, built with the white-label domain helper. Never use DELETE contact as a merge.
2. Matching tiers: High = same normalised E.164 phone or same lowercased email (strip +tags, gmail dots optional); Medium = same phone-last-9 or fuzzy name + one shared identifier; Low = name only. Show tier and a one-line reason ("same phone, different email"). Never auto-act.
3. Scan = paged POST /contacts/search nightly plus ContactCreate/ContactUpdate incremental; use GET /contacts/search/duplicate only as a cheap real-time check on new contacts. Respect 100/10s via the X-RateLimit headers and the existing queue.
4. Protect people: exclude DND and contacts with open deals, upcoming appointments, payments or workflows from any "safe to merge/clean" suggestion; flag them as "review by hand".
5. Intake quality: poll GET /forms/submissions and /surveys/submissions (no webhook exists) every 15 to 30 minutes with startAt/endAt, join by contactId to attributionSource, and store per-source junk/duplicate/answered/no-show/revenue. Say plainly: "Page views and funnel conversion are not available from the platform yet."
6. Junk and spam rules (read-only flags): invalid/disposable email, non-dialable phone, repeated gibberish name, same IP or fingerprint burst, names containing "test". Provide a "mark as test" local label that hides it from our metrics without touching the CRM.
7. Account quality score 0-100 per account with a one-line formula (duplicate rate, missing contact info, invalid phone, test contacts, unsourced leads), stored daily in the event store for trend; agency view ranks accounts; show "not enough data" under a minimum contact count.
8. Read location settings (`allowDuplicateContact`) and surface "Duplicates are allowed in this account: forms will create a second record" as a one-tap explanation and fix instruction (writing settings is not in the API; instruct the user).
9. Optional write (behind preview/confirm/undo/audit): add tag "possible-duplicate" and a note via contacts.write; these writes are logged and excluded from reply/activity metrics and from webhook echoes (rule 14).
10. Scopes to add as OPTIONAL (exact spellings VERIFIED in docs/oauth/Scopes.md): `forms.readonly`, `surveys.readonly`, `funnels/funnel.readonly`, `funnels/page.readonly`, `funnels/pagecount.readonly`, `contacts.write` (only for tag/note writes), plus confirm already held: `contacts.readonly`, `locations.readonly`, `opportunities.readonly`, `calendars/events.readonly`, `locations/customFields.readonly`, `locations/tags.readonly`. Graceful "Needs permission: reconnect" when absent. Adding scopes forces re-approval, so batch into release 1.1.0.
11. Webhooks to subscribe: ContactCreate, ContactUpdate, ContactDelete (merge/removal signal), ContactDndUpdate, ContactTagUpdate, NoteCreate (echo filtering), OpportunityCreate, OpportunityStatusUpdate, AppointmentCreate, AppointmentUpdate, AppInstall, AppUninstall, PlanChange. Idempotent handlers; nightly reconcile because webhooks can be missed and no merge/form events exist.
12. Pricing/position: Dedupely starts $40/mo per 30k records, Insycle $100/mo and neither lists this CRM platform (VERIFIED); native tool is free but manual and single-field. Keep this inside the $11.50 Pro plan as a feeder to the speed-to-lead and appointment modules (duplicates cause double-texting and wasted calls), not a standalone SKU. Verify live before building: GET /contacts/search/duplicate response shape, a real merge's webhook trace, `appointmentStatus` values, and whether `attributionSource` is populated for form and for ad-lead contacts.
