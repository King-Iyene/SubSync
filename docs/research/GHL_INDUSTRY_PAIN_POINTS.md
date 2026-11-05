# Industry pain points on GHL, turned into SubSync features (5 Nov 2026)

Companion to `GHL_API_FEATURE_MAP.md`. **Evidence limits:** the GHL ideas board, Canny changelog, Reddit, Facebook groups and YouTube could not be read from this sandbox (DNS blocked for ideas.gohighlevel.com and highlevel.canny.io; the other community sites were not reachable). Nothing below is a community quote. Every pain is **INFERENCE**: it comes from the repo research (`docs/COMPETITORS.md`, `docs/research/*`, `docs/REAL_ESTATE.md`), from search snippets of third-party blogs, and from how the GHL API is shaped. Where a pain is a documented GHL behaviour (for example per-account reports, no stage history), it is marked VERIFIED against the connector catalogue or CLAUDE.md. Rows to re-check once the ideas board is readable are marked RECHECK.

Verdicts: SAFE (no sign GHL builds it), RISK (partly native or requested), NATIVE (skip). API group names match section 1 of the map.

## 1. Sales teams, setters and closers

| # | Pain on GHL | Who feels it | Evidence | API group | Overlap |
| --- | --- | --- | --- | --- | --- |
| 1 | Nobody can prove how fast each setter answered a new lead, across accounts | Agency owner, sales manager | VERIFIED: reports are per account (CLAUDE.md 1); INFERENCE on demand | conversations messages, users | RISK-low (native "User Replied" SLA triggers; measurement SAFE) |
| 2 | Setters forget to mark appointment outcomes, so show rate lies | Closer, owner | INFERENCE; appointment status field VERIFIED live (38 read) | calendars events | SAFE |
| 3 | Follow-up dies after 1 to 2 touches; hot leads untouched for days | Setter | INFERENCE; vendor pages push "under 5 minutes" as a workaround | conversations, opportunities | RISK (workflow ladders native) |
| 4 | No person-level history: who is improving, who is idle | Sales manager | VERIFIED: GHL keeps no stage or status history | users, messages, events | RISK-low (per-account user reports native; cross-account SAFE) |
| 5 | Call and booking handoff gaps: lead booked but closer never called | Closer | INFERENCE | calendars, conversations, opportunities | SAFE |

| Feature (fixes pain) | Moat angle | API support | Verdict |
| --- | --- | --- | --- |
| Setter scorecard: median first touch, % inside SLA, outcomes marked, own history only (1, 2, 4) | History per person; benchmark "setters like yours" by industry | `conversations/message.readonly`, `users.readonly`, `calendars/events.readonly` (CHECK sender userId) | RISK-low |
| "Booked but not called" and "marked no outcome" queue (2, 5) | Receipts show it caught and fixed | calendars events, messages | SAFE |

## 2. Real estate

| # | Pain on GHL | Who feels it | Evidence | API group | Overlap |
| --- | --- | --- | --- | --- | --- |
| 1 | Portal and ad leads (Zillow, Facebook) go cold in minutes; response time decides who wins | Agent, team lead | INFERENCE (industry norm); repo `docs/REAL_ESTATE.md` | conversations, contacts | RISK (speed workflows native) |
| 2 | Long nurture: old leads and past clients never reactivated | Agent | INFERENCE | contacts, opportunities | RISK (campaigns native; reactivation list SAFE) |
| 3 | Pipeline full of junk or stale deals; no per-stage ageing | Team lead | VERIFIED: brief 13A found global stale rule wrong | opportunities | RISK |
| 4 | Showings and open-house no-shows not recovered | Agent | INFERENCE | calendars events | SAFE |
| 5 | Listings, buyers and sellers are custom objects nobody reports on | Broker | INFERENCE | objects, associations | SAFE (niche) |

| Feature | Moat angle | API | Verdict |
| --- | --- | --- | --- |
| Lead-source speed ranking: which portal leads are answered slowest and what that costs (1) | Benchmarks by industry (real estate median first reply) | messages, contacts source | RISK-low |
| Reactivation shortlist: past leads who replied once, no touch 90+ days, ranked (2) | History of what was re-engaged (Receipts) | contacts, conversations | SAFE |

## 3. Health and wellness (clinics, med spas, dentists, chiropractors)

**Compliance warning (INFERENCE, needs a legal review):** these accounts hold patient data and often health notes in contacts, notes, forms and call recordings. GHL is not HIPAA-compliant by default and requires a signed BAA and the HIPAA add-on (INFERENCE, check GHL docs); we are not a business associate. Therefore for this industry SubSync must stay **read-only and metadata-only**: store timestamps, counts, statuses, IDs and hashed contact ids; never copy message text, notes, form answers, transcripts, recordings, diagnoses, tags that reveal conditions, or free-text custom fields. No AI over message bodies. No write scopes (no tags, notes or tasks) until a lawyer approves. DND and unsubscribed contacts are never touched (principle 8). Offer an account-level "health mode" that disables message-text scopes, transcription and exports with names, and keeps benchmarks aggregate-only. Do not request `conversations/message.readonly` transcription paths for these accounts.

| # | Pain on GHL | Who feels it | Evidence | API group | Overlap |
| --- | --- | --- | --- | --- | --- |
| 1 | No-shows and late cancels burn chair or room time | Clinic manager, owner | INFERENCE (common in the vertical); appointment status VERIFIED | calendars events | RISK-low (reminders native; true rate SAFE) |
| 2 | Missed calls after hours, no callback | Front desk | INFERENCE | conversations, phone-system | RISK (missed-call text-back native) |
| 3 | Reactivation of lapsed patients and expired packages | Owner | INFERENCE | contacts, opportunities, payments | RISK |
| 4 | Consent and DND handling: texting people who opted out, A2P rejections | Owner, agency | INFERENCE (A2P pain widely discussed) | phone-system, messages status | SAFE cross-account |
| 5 | Reviews after visits not requested; reputation invisible | Owner | INFERENCE; **no reviews API** (BLOCKED, map section 1) | none | BLOCKED |

| Feature | Moat angle | API | Verdict |
| --- | --- | --- | --- |
| Chair-time at risk: no-shows and unmarked appointments, counts and dollar estimate only (1) | History plus med-spa benchmarks (needs 10 accounts, 3 agencies) | calendars events, products price CHECK | SAFE |
| Consent and delivery health: opt-out, failed and blocked text rate, number registration status, metadata only (4) | Delivery history per number | messages `status`, `phonenumbers.read` | SAFE |

## 4. Coaches and consultants

| # | Pain on GHL | Who feels it | Evidence | API group | Overlap |
| --- | --- | --- | --- | --- | --- |
| 1 | Discovery-call no-shows; calls booked with unqualified leads | Coach | INFERENCE | calendars, forms | RISK-low |
| 2 | Payment failures and stuck payment plans | Coach, bookkeeper | INFERENCE | payments subscriptions, invoices | RISK-low (dunning native per account) |
| 3 | Course or membership drop-off: enrolled but inactive | Coach | INFERENCE | courses enrollments | SAFE |
| 4 | Booking page or form silently broken after edits | Coach | INFERENCE | forms, calendars slots | SAFE |
| 5 | Pipeline of "interested" leads never followed up | Coach | INFERENCE | opportunities, conversations | RISK |

| Feature | Moat angle | API | Verdict |
| --- | --- | --- | --- |
| Money-at-risk: failed cards, past-due plans, unpaid invoices in one list (2) | Recovery history ("recovered $X this quarter") for Receipts | `payments/*.readonly`, `invoices.readonly` | SAFE |
| Silent-failure watch: form or booking drop vs own normal (4) | Baselines accumulate | `forms.readonly`, `calendars.readonly` | SAFE |

## 5. Fashion, retail, e-commerce

| # | Pain on GHL | Who feels it | Evidence | API group | Overlap |
| --- | --- | --- | --- | --- | --- |
| 1 | Abandoned carts and win-back are workflow-only, hard to see if they fire | Store owner | INFERENCE | products/store, orders CHECK, workflows | RISK |
| 2 | Email list growth and quality unclear; bounce and spam hurts delivery | Marketer | INFERENCE | contacts, emails stats | SAFE (growth chart) |
| 3 | Revenue by source (ads, email, SMS) not trusted | Owner, agency | INFERENCE; native attribution report exists | contacts attribution, ad-publishing, payments | RISK |
| 4 | Product, price and stock errors across stores | Agency | INFERENCE; product bulk edit limited to 30 (VERIFIED catalogue) | products | SAFE, niche |
| 5 | Review and reputation tracking | Owner | no API found | none | BLOCKED |

| Feature | Moat angle | API | Verdict |
| --- | --- | --- | --- |
| Email growth and list-health tracker with bulk validation credits (2) | Our list-size history; credits give recurring revenue | contacts, `emails/stats.readonly`, `lc-email.readonly` CHECK, `charges.write` | SAFE for tracker, RISK for validation |
| Cart-recovery outcome check: abandoned checkouts vs recovered orders (1) | Receipts: "recovered $X" | orders/transactions CHECK | RISK, check native first |

## 6. Home services and solar

| # | Pain on GHL | Who feels it | Evidence | API group | Overlap |
| --- | --- | --- | --- | --- | --- |
| 1 | Missed calls and slow first reply lose the job to the next quote | Owner, dispatcher | INFERENCE; speed-to-lead is the brief's wedge | conversations, phone-system | RISK-low |
| 2 | Estimates sent but never followed up; quote-to-close unseen | Owner | INFERENCE | invoices estimates, opportunities | SAFE (cross-account) |
| 3 | Appointment (site visit) no-shows and reschedules | Dispatcher | INFERENCE | calendars events | SAFE |
| 4 | Solar: long cycle, deals stall between survey and install; stage ageing | Sales manager | INFERENCE | opportunities | SAFE (stage history ours) |
| 5 | Reviews after jobs | Owner | no API | none | BLOCKED |

| Feature | Moat angle | API | Verdict |
| --- | --- | --- | --- |
| Estimate follow-up watch: estimates sent with no reply or payment after N days (2) | History, Receipts dollars | `invoices/estimate.readonly`, conversations | SAFE |
| Stage-dwell alerts per pipeline stage, solar defaults (4) | Our event store; industry benchmarks | `opportunities.readonly` | SAFE |

## 7. Industry features ranked (all industries, merged with the map's list)

Score = money + moat + feasibility + safety (max 20). Industry column shows who asks for it.

| # | Feature | Industries | Score | Verdict | Scopes (new ones marked +) |
| --- | --- | --- | --- | --- | --- |
| 1 | Speed-to-lead and setter scorecard | sales, real estate, home services | 18 | RISK-low | messages, users, contacts |
| 2 | True show rate, unmarked outcomes, no-show recovery | all, esp. health, coaches | 18 | RISK-low | calendars events |
| 3 | Client Receipts (white-label proof incl. dollars recovered) | all via agency | 17 | SAFE | none |
| 4 | Email growth and list-health tracker | e-commerce, coaches, health | 17 | SAFE | emails stats |
| 5 | Industry benchmarks (show rate, first reply, list growth) | health, real estate, solar | 16 | SAFE | none; needs 10 accounts |
| 6 | Bulk email validation with credits | e-commerce, coaches | 15 | RISK | + `lc-email.readonly`, `charges.write` |
| 7 | Money-at-risk list (failed cards, past-due, estimates) | coaches, home services | 15 | SAFE | + payments, invoices |
| 8 | Consent and text-delivery health (metadata only) | health, all | 15 | SAFE | + `phonenumbers.read` |
| 9 | Silent-failure watch (forms, booking page) | coaches, all | 15 | SAFE | + `forms.readonly` |
| 10 | Stage-dwell and stale alerts per stage | solar, real estate | 14 | SAFE | opportunities |
| 11 | Reactivation shortlist (read-only) | real estate, health | 14 | SAFE | contacts, conversations |
| 12 | Estimate follow-up watch | home services, solar | 14 | SAFE | + invoices estimates |
| 13 | Go-live scorecard for new client accounts | agency | 14 | SAFE | + customValues, phone |
| 14 | Agency user and permission audit | agency | 14 | SAFE | users |
| 15 | AI receptionist QA (metadata: outcome, duration, booked) | health, home services | 12 | RISK | + `voice-ai-dashboard.readonly` |

Notes: transcript or message-body features are excluded for health. Reviews and reputation are BLOCKED across all industries until GHL exposes an API.

## 8. Marketplace changes that affect our listing (from King's note; INFERENCE, Canny not readable)

King reports GHL's "Latest Updates" (Canny) shows: multiple Facebook accounts and Marketplace migration, a revamped Marketplace app detail page, and "Discover Marketplace Apps with Ask AI". I could not open the Canny changelog or ideas board here, so treat the details as unconfirmed.

| Change | What it means for SubSync | Action |
| --- | --- | --- |
| Ask AI app discovery | Buyers may find apps by describing a problem in plain words; the AI reads our listing text | Write the description in plain outcome words ("find leads nobody answered", "show rate", "no-shows"), one clear paragraph, no jargon, no platform name per white-label rule. Name each problem the way an owner says it. |
| Revamped app detail page | New layout may change what screenshots, feature lines and permission text show | Re-check screenshots, the 3 to 5 feature lines and the permission explanations after the next release; keep claims only for live features (principle 5). |
| Marketplace migration | Listing data or install URLs may move | Verify redirect URLs and listing fields after the migration; do not edit modules on the live app (CLAUDE.md 2A). |
| Plan and pricing fields | Unchanged as far as known | Keep the pre-pilot gate (Pro $9). |

## 9. To finish the evidence (needs allow-list or King)

1. Allow `ideas.gohighlevel.com` and `highlevel.canny.io` (and the changelog subdomain) so the RISK rows can be confirmed against real requests and statuses.
2. King can paste the top-voted requests for: Reporting, Conversations, Calendars, Snapshots, SaaS, Marketplace. I will re-label the verdicts.
3. Have a lawyer confirm the health-mode limits before any clinic installs.
