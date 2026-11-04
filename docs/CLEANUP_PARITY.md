# Clean-up parity: what the standard dedupe and data-quality tools do, and where SubSync stands (stage CLEANUP, 5 Nov 2026)

King's words: "they should be THESE TOOLS' STANDARD, and alike in features if possible." Added by the lead: "parity is the floor, not the goal", and "SubSync MUST write to the CRM where needed".

Read this first, then the table. Labels: **VERIFIED** (read on the vendor's or the platform's own page), **V-3P** (a third-party page: a review site or an aggregator; weaker, several disagree), **INFERENCE** (my reasoning). Research was done on public pages only on 4 to 5 Nov 2026; nothing was signed up for and no API was called with credentials. Where a vendor page could not be read (Cloudingo, DataGroomr, DemandTools, Validity: 403/404) the row leans on V-3P and says so.

## 1. The money-first test (plain words)

**Pain.** A client's contact list fills with duplicates, typos, throwaway emails, numbers in ten formats and test junk. Staff text the same person twice, campaigns bounce, reports are inflated, and the client sees the mess. Nobody cleans it because the CRM's own tool works one client account at a time and needs an administrator.

**Who feels it.** The ops person who cleans (hours per client); the setter who calls the wrong copy; the business owner who sees "Ada Lovelace" twice; the agency owner whose reports are wrong in all 40 clients and who cannot see which client is worst.

**The five-second proof number.** "Data quality 87 out of 100 across 13 clients. The worst: Green Leaf Landscaping, 81, 70 problems, 9 duplicate groups." One number, the worst client named, one button.

**Why pay $9 per client account instead of the standard tools.** The standard tools are built for ONE database and priced for one: Insycle from $100 a month per portal (annual billing; each client database needs its own plan through its agency link, V-3P), Dedupely from $40 a month for 30,000 records (V), Cloudingo $2,500 to $10,000 a year (V-3P, weak), DemandTools about $3,000 to $6,000 a year per Salesforce org (V-3P), DataGroomr about $1,500 to $5,800 a year (V-3P). Plauti does not publish a price and is the top price bracket on G2. Only Koalify (free under 10,000 records, then $25 a month, V) and DupeCatcher (free, V) are cheap, and they are narrow (HubSpot-only rules, Salesforce-only prevention). An agency with 20 clients pays SubSync $180 a month in total, finds and fixes across all 20 in one screen, and can show each client a before-and-after score. No other tool in this list has a cross-client console: Insycle has an agency mode but each client is a separate login and plan; Dedupely lets several portals sync into one account but has no agency pricing page (404).

**What to cut / not build.** Cross-object matching (companies, deals): SubSync copies contacts, not companies, so it is not built (proposal). Real-time prevention at record creation: needs a hook inside the CRM; what SubSync can honestly do is the "Stop new duplicates" recipe and the import check. Enrichment (finding missing emails from outside data): needs a data vendor; not built. Phonetic matching beyond last-name Soundex and nicknames: a short list is enough for contacts.

## 2. What the tools do and what SubSync does

Status words: **Built** (read-only, works today); **Built, off until enabled** (the write path is built and tested with a stub; nothing is sent until King sets one server variable and a person allows the account); **Partial**; **Proposal** (docs/PROPOSALS.md); **Not possible**; **Not worth it**.

### 2.1 Matching

| Area | What the standard tools do | Source | SubSync now | Status |
|---|---|---|---|---|
| Exact and fuzzy match rules on chosen fields | Salesforce native: exact and fuzzy; Plauti: fuzzy and exact per field with weights; Dedupely: exact, similar, fuzzy, similar words; Koalify: custom rules over any property mix; HubSpot: default rules, 2 custom per object | V: trailhead, plauti.com, dedupe.ly/features, HubSpot listing, HubSpot KB | Per client: which of email, phone and name count and how (exact or similar), plus "a name on its own may start a group" and a strictness number | Built |
| Presets | Few tools offer plain presets; most expose a rule builder (Plauti AI drafts scenarios, Clientell uses plain language) | V: plauti.com, V-3P: getclientell | Strict, Balanced (how SubSync always matched), Loose, shown with a one-line promise each, and the number of groups each would find BEFORE saving | Built (better than the field) |
| Phonetic and nickname matching | Salesforce native: Metaphone 3 and Name Variant; Plauti: synonym lists (Robert/Bob); DemandTools: nicknames | V: trailhead, plauti.com, V-3P | Soundex on the last name, about 130 common nicknames, initials ("J." and "John"), Jaro-Winkler for typos, "Smith, John" and "Smith John" read as John Smith | Built |
| Transposed digits, shared household phone, shared company mailbox | Not found as named features in any tool read | none found | Two digits swapped; a phone shared by different first names is grouped but scored "could be", not "certain"; info@ and sales@ shared by different people likewise (guards, on by default) | Built (an improvement) |
| Common names are not grouped | Dedupely: safety settings set aside oversized and placeholder matches; HubSpot warns when a rule matches over 10 percent of records | V: dedupe.ly, HubSpot KB | A name shared by more than 8 contacts is never grouped on the name alone; a group never spans two accounts; two records that clearly differ (a different email AND phone) are never grouped | Built |
| Match score and confidence thresholds | Plauti: minimum score per scenario; Salesforce: weighted address score; DemandTools: configurable strictness | V: plauti.com, trailhead, V-3P | A 0 to 100 score per group and per pair, the reasons in words ("Same email address", "A similar name"), the rules that were used, and a threshold slider (25 to 90) | Built |
| Matching across objects (contacts, companies, deals) | Plauti, DemandTools (table to table), Insycle, Koalify: yes | V: plauti.com, V-3P, V | Contacts inside one client account only. The company name is not copied into SubSync, deals have no identity of their own | Proposal (needs the company name synced) |
| Learning from decisions | Dedupely: Excluded and Rejected matches are skipped; HubSpot: a rejected pair is skipped and restorable for 14 days | V: dedupe.ly, HubSpot KB | "Not a duplicate" is remembered per group and never returns; Undo restores it; "Not now" comes back after 7 days | Built. Lowering the score of similar pairs after a rejection: Proposal |

### 2.2 Merging

| Area | What the standard tools do | Source | SubSync now | Status |
|---|---|---|---|---|
| Survivorship (which record and which value wins) | Plauti: stacked master rules (oldest, most recent, most complete) plus field rules; Dedupely: merge rules and custom merge per field; Insycle: custom master rules; Koalify: per-property winning value; HubSpot: up to 5 criteria and 20 overrides | V | Which RECORD to keep (pre-picked with its reason in words) and which VALUE wins per field (name, email, phone, owner, source): the record kept, the most recent, the fullest, or the oldest. Saved per client, with a company default | Built |
| Merge preview | Dedupely "Match Details"; Insycle preview mode and CSV report; HubSpot review step | V | A merge sheet listing what is kept, moved and removed, what each field becomes, the warnings and the exact steps | Built |
| Bulk and batch merge, auto-merge of high-confidence matches | Dedupely: single, bulk and scheduled Auto Merge on every plan; Plauti: groups above a score auto-merge; Cloudingo Pro; Insycle bulk or automatic; Koalify via a workflow action | V | "Merge all the obvious ones" lists the exact matches as a preview. One merge at a time can be started from SubSync through the customer's own merge workflow (see section 3). Automatic merging is deliberately NOT built: a merge cannot be undone on this platform | Merge one: Built, off until enabled. Auto-merge: Not worth it (irreversible) |
| Merge the real way (history kept) | The CRM's own merge; the workflow action "Merge Contact" | V (help articles) | Open both contacts in the CRM, copy the summary, "I merged them" | Built |
| Undo and rollback | Dedupely: most merges undoable for 30 days; Plauti: Restore; DemandTools: Undo Merge; Cloudingo Pro: backup and restore; DataGroomr: paid add-ons; HubSpot native: merges cannot be reverted | V, V-3P | SubSync-side decisions (not a duplicate, not now, merged) are undone with one click, here and in History. A clean-up fix (phone, name, email, tag) stores the value it replaced and the whole run can be undone. A merge cannot be undone anywhere on this platform (the help article says so) and SubSync says so before it starts | Built. Merge undo: Not possible |
| Merge history and audit log | Dedupely: Merge History with originals, who and when, CSV export; Insycle: one audit trail; Plauti: audit entry per change; HubSpot: merge history (Data Hub Pro) | V | History tab: every decision, set-aside, merge request, clean-up run, rule change, allow/stop switch and "nothing was sent" line, with who and when, filtered by kind, paged; undo where still possible | Built |

### 2.3 Finding and preventing

| Area | What the standard tools do | Source | SubSync now | Status |
|---|---|---|---|---|
| Scheduled scans and alerts | Dedupely Auto Match notifies; Plauti scheduled jobs and monitor alerts; HubSpot rescans daily and sends a weekly data-quality email | V | A daily scan inside the existing refresh: today's score per client is stored, and an alert (the bell; email and Slack only through the existing switches, which are off) is raised when 3 or more new likely duplicate groups appear in a client | Built |
| Real-time prevention at creation | DupeCatcher (free), Plauti, DataGroomr Live Dedupe | V, V-3P | Cannot run inside the CRM. SubSync gives a five-step copyable recipe for the CRM's own duplicate settings (Allow Duplicate Contact off, Email then Phone as the match fields, check every form and integration) and the import check | Recipe: Built. True prevention: Not possible (needs a hook in the CRM) |
| Import dedupe | DemandTools Import module; Dedupely CSV deduplication; Insycle Magical Import | V, V-3P | Paste or choose a CSV (up to 5,000 people): each row is "already in this account", "could already be here", "twice in the file", "cannot work" or "new", with the matching contact opened in the CRM, and only the new people can be copied back as CSV. Read in memory, never stored | Built |
| Duplicates across the whole portfolio | Insycle agency mode; Dedupely several portals into one account | V-3P, V | One list across every client, clients with the most at stake first, top 5 plus See all, server-paged, tested at 150 accounts and 5,000 groups | Built (an improvement) |

### 2.4 Standardization, validation, quality

| Area | What the standard tools do | Source | SubSync now | Status |
|---|---|---|---|---|
| Phone to international format | Insycle 60+ formatting functions; DemandTools lookup tables; Plauti Verify | V | Finds numbers not in +digits form, shows the exact fix (needs the country code for local numbers, never guessed), copies the fixes as CSV, and can apply them | Find, fix list, CSV: Built. Apply in the CRM: Built, off until enabled |
| Name case | Insycle, HubSpot formatting issues | V | Only names entirely in capitals or lower case; "McDonald" is left alone | Built; apply: off until enabled |
| Email typos and domains | Insycle fixes email typos; HubSpot lowercases | V | A list of well-known mistakes (gmial.com, name@gmail.con, .cmo) with the exact corrected address | Built; apply: off until enabled |
| Invalid emails and phones, disposable domains, role addresses | DataGroomr Verify (email format, domain, shared address; phone line type; credit metered); Plauti Verify; BriteVerify via DemandTools. Disposable and role detection were not found as named features in the pages read | V, V-3P | Emails that cannot work, 22 throwaway domains, role mailboxes (info@, sales@), numbers too short or too long, made-up numbers. Format and list checks only: SubSync does not ping a mailbox or look up a carrier (that needs a paid verification service) | Built (format and lists). Live verification: Not worth it at this price |
| Missing fields, empty names, test and junk records | HubSpot Command Center (enrichment gaps, unused properties); Insycle gap lists; junk detection not found as a named feature | V | Nobody can be reached, no name, empty contacts, test records ("test user", test@example.com), placeholder numbers | Built |
| Data-quality score, trend, per-field completeness | Insycle Health Assessment; HubSpot Command Center: issue counts over time and a weekly digest | V | A 0 to 100 score per client and for the portfolio (five parts, written formula in docs/METRICS.md), a trend from stored daily snapshots only ("not enough history yet" until 2 snapshots 3 days apart), worst client first | Built |
| Enrichment | Insycle, Plauti, DataGroomr via vendors | V | None | Not worth it (needs an outside data vendor and a new permission) |
| Saved rules per account | Insycle templates and recipes; Dedupely merge rules; Plauti scenarios | V | Rules saved per client with a company default; "go back to the company default" per client | Built (needs the database update, section 5 of docs/features/CLEANUP.md) |
| Team approval workflows | Clientell approval-gated merges | V-3P | A merge needs a deliberate confirm (a ticked box) and a client's staff cannot start one. A two-person approval is not built | Proposal |
| Reports and exports | Dedupely CSV export; Insycle CSV report | V | Copy a summary, download the group list, download the fixes as CSV per problem, copy the new people of a file | Built. A white-label printable before-and-after proof: Proposal |

### 2.5 Writing back to the CRM (King's instruction of 5 Nov: SubSync MUST write where needed)

| Action | Route | Scope | Status |
|---|---|---|---|
| Phone, name, email fixes | `PUT /contacts/{id}` after re-reading the contact; skipped if it changed since the preview; the old value is stored for undo | `contacts.write` (already optional) | Built, off until enabled |
| Tags add or remove | `POST` or `DELETE /contacts/{id}/tags` | `contacts.write` | Built, off until enabled (existing) |
| Merge two contacts | Adds the NEWER record to the customer's own workflow that has the "Merge Contact" action (`POST /contacts/{id}/workflow/{workflowId}`); the CRM merges it into the OLDER record and keeps conversations, deals and notes | `contacts.write` (already optional); `workflows.readonly` would let SubSync check the workflow is published (new, optional, not needed) | Built, off until enabled. Limits are real and shown in words (section 3) |
| Delete a contact | `DELETE /contacts/{id}` exists but is permanent and loses history | `contacts.write` | Not built: a merge in the CRM already removes the extra record safely, and junk is listed with its CSV for the person to remove |
| Move deals, conversations, appointments between contacts | No such call in the public API | none | Not possible |

Every write goes through ONE gateway (`src/lib/ghl/crm-gateway.ts`): the server's master switch `WRITE_GHL_LIVE` (off), the per-account opt-in (off, set in Settings), a preview, a deliberate confirm, guardrails (Do Not Disturb, deals, a paying customer, different owners, clearly different people, never across two accounts), spaced calls (about 7 a second), a stored before-value for undo, and one audit line per write with ids and field names only. See section 3 for the merge route and `docs/NEEDS_KING.md` section 29 for the exact steps King follows.

## 3. The real merge: what is possible (VERIFIED on 5 Nov 2026 from the platform's help pages and API description)

- The public API has **no merge call**. `GET /contacts/search/duplicate` only finds one contact for an email or phone.
- The workflow action **Merge Contact** takes **no second contact**: it looks at the contact in the workflow, finds another contact in the same account with the same email, phone or both (the customer chooses which) and merges them. **The older record survives.** What it does with Do Not Disturb, appointments and payments is not written down; the manual merge's article says appointments, payments and invoices keep the kept contact's values.
- An app **can add a contact to a workflow** by API (`POST /contacts/{contactId}/workflow/{workflowId}`, scope `contacts.write`, a location token). An app **cannot create a workflow** (the workflows API has only a list call), so the customer builds one workflow once per client.
- So the safest "one click" is: SubSync prepares the pair, the customer confirms, SubSync adds the newer record to their merge workflow, the CRM merges. It is honest about four limits: it needs an exact email or phone match; it merges ANY other contact sharing that value (so SubSync refuses when a third record shares it); the older record always wins (SubSync says when that differs from its pick); a merge cannot be undone, so Do Not Disturb stops it.
- What is NOT verified: whether the workflow must be published for the API enrolment (SubSync checks the status if the optional scope is present, otherwise it says so in the first-test plan), the `Version` header value (the documents disagree: `2021-07-28` and `v3`), and what the merge does with Do Not Disturb. All three are in the first live test plan.
- Sources: help.gohighlevel.com article "Workflow action: Merge Contact" (155000007464), the changelog entry `highlevel.canny.io/changelog/merge-contact-action`, marketplace.gohighlevel.com/docs/ghl/contacts/add-contact-to-workflow, the public API description `GoHighLevel/highlevel-api-docs` (`apps/contacts.json`, `apps/opportunities.json`, `apps/workflows.json`), the help article "How to Manage and Merge Duplicate Contacts" (48001202210), and the request "Merge Contacts through API" (66 votes, no answer) at `highlevel.canny.io/apis/p/merge-contacts-through-api`.

## 4. Improvements over the standard (what an agency running many clients gets)

| Idea | Status |
|---|---|
| One cross-account console with company-wide rules and per-client overrides | Built (Rules tab; the account follows the company default until it has its own) |
| "Why these two match" in plain words and a confidence score, per group and per pair | Built |
| What a setting would find, before saving it | Built |
| Household and shared-mailbox awareness | Built |
| A data-quality score per client and for the portfolio, worst first, with a trend from stored snapshots | Built |
| Alert when new likely duplicates appear | Built (the bell; email and Slack stay behind their existing off switches) |
| Check a file before importing | Built |
| Copyable prevention recipe for the CRM's own settings | Built |
| Per-account opt-in, one write gateway, dry run until King flips one switch | Built |
| Learning: a rejected pair lowers the score of similar pairs | Proposal |
| Safe auto-merge of exact matches with a review window and one-click rollback | Not possible as written: a merge cannot be rolled back on this platform (proposal for a "queue and review window" that stops before the merge) |
| Client-facing before and after proof of value, white-label and printable | Proposal (the stored snapshots are the data it needs) |
| Prevention at the source for forms and integrations (checking each one) | Proposal (needs read access to forms; scope `forms.readonly`) |
| Weekly digest of what was found and fixed | Proposal (the numbers exist; the weekly email is another stage's file) |
| Speed at 20,000 and more contacts per account | Built and tested: the scan and grouping of 20,000 contacts run in well under a second in the unit test; candidate reads are capped at 60,000 per request and say so; the quality scan reads at most 120,000 contacts per client |
