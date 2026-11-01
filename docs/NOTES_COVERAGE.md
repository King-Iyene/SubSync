# Notes coverage ledger

One row for every review note (N1 to N104) and every buyer-review finding. Maintained with `node scripts/notes-coverage.mjs`. Statuses: DONE-TONIGHT (with evidence in the last column), PLANNED-LATER (the stage is named), NEEDS-KING (the item is in docs/NEEDS_KING.md), PARKED (the reason is given), NOT-A-CODE-ITEM (a decision, a question or an observation).

ORPHANS (notes with no stage in docs/ROADMAP_V2.md): none found.

<!-- TABLE -->
| ID | Title | Stage | Status | Evidence or reason |
| --- | --- | --- | --- | --- |
| N1 | Today: the filter bar is unclear | F5, F1, F8 | PLANNED-LATER |  |
| N2 | Today needs a client-account (sub-account) version | F5 | PLANNED-LATER |  |
| N3 | UI/UX redesign: "it looks somehow not sweet" | D0, D1 | PLANNED-LATER |  |
| N4 | Today: the "When this is sent" card at the bottom | F9, F5, F8 | PLANNED-LATER |  |
| N5 | Today: "Not watched yet" card, ship what is doable | F2, F4, F9, F8 | PLANNED-LATER |  |
| N6 | Things I noticed in the same screenshots | F1, F5 | PLANNED-LATER |  |
| N7 | Dead ends: no way back | F5, F6, D1 | PLANNED-LATER |  |
| N8 | A client-account filter wherever data is shown | F1, F5, D0 | PLANNED-LATER |  |
| N9 | Status text and notifications should not sit in cards | D1, F5 | PLANNED-LATER |  |
| N10 | Design quality: "not human built", "the gauge looks child built" | D0, D1 | PLANNED-LATER |  |
| N11 | "SLA" is jargon | F4, F5 | PLANNED-LATER |  |
| N12 | Filter by how long someone has waited, with a better view | F4 | PLANNED-LATER |  |
| N13 | Why is "Older than a week (13)" hidden? | F4 | PLANNED-LATER |  |
| N14 | Long lists make the page unusable | F4, D0 | PLANNED-LATER |  |
| N15 | The Inbox page contradicts itself on numbers | F1, F4 | PLANNED-LATER |  |
| N16 | Health labels contradict "Needs attention" | F1 (item 3), F5 | PLANNED-LATER |  |
| N17 | Progress seen | none (progress note) | NOT-A-CODE-ITEM | an observation that earlier fixes landed |
| N18 | Same conversation appears in three accounts | F2 | PLANNED-LATER |  |
| N19 | Design still "not mature" on Speed to lead, Appointments and Insights | D0, D1 | PLANNED-LATER |  |
| N20 | Smart Lists and dialing | F10 | PLANNED-LATER |  |
| N21 | Show names and photos, not IDs | F2, F8 | PLANNED-LATER |  |
| N22 | "Not enough data" without a reason | F2 | PLANNED-LATER |  |
| N23 | Empty charts look broken | F2, D1 | PLANNED-LATER |  |
| N24 | Appointments "To do" tab is blank and vague | F3 | PLANNED-LATER |  |
| N25 | Appointment details and statuses | F3 | PLANNED-LATER |  |
| N26 | Appointment Insights: unexplained graphs, no way to adjust | F3 | PLANNED-LATER |  |
| N27 | Sales team accountability: setters and closers | T1 (never tonight) | NEEDS-KING | King must define setter and closer before T1 starts |
| N28 | Structure first | D0 | PLANNED-LATER |  |
| N29 | Easy for everyone | D0, D1, F5 | PLANNED-LATER |  |
| N30 | More observations on Speed to lead | F2 | PLANNED-LATER |  |
| N31 | Good things worth keeping | none (keep list) | NOT-A-CODE-ITEM | things to keep, no change |
| N32 | Meeting notes: what is it, from what, and what do the switches do? | E2a (E1 later), D0 | PLANNED-LATER |  |
| N33 | Auto-sync is not running: "Last synced" keeps growing | S0.4 | PLANNED-LATER |  |
| N34 | Filters must adapt to who is looking | D0 | PLANNED-LATER |  |
| N35 | Contact search is plain: merge it and build paying features around it | F10, D0 | PLANNED-LATER |  |
| N36 | Pipeline is one endless page | P1 (never tonight), D0 pattern | PLANNED-LATER |  |
| N37 | Forecast trust: "why should they trust your forecast? how are you calculating?" | F1, P1 | PLANNED-LATER |  |
| N38 | Stage awareness: closed-out stages and junk pipelines flagged as dead or risky | F1, P1 | PLANNED-LATER |  |
| N39 | The pipeline-over-time chart shows a definition change as a trend | F1, P1 | PLANNED-LATER |  |
| N40 | "Clients should live in SubSync": a safe actions layer with write scopes | W1 (never tonight) | PLANNED-LATER |  |
| N41 | Payments module idea | R1 | PARKED | waits for evidence and King's decision |
| N42 | In-app notification centre | F9 | PLANNED-LATER |  |
| N43 | More observations on these screens | none (observations; menu in D0, junk data in F1) | NOT-A-CODE-ITEM | observations folded into D0 and F1 |
| N44 | Leads page: too many cards, and what is each data point for? | F1, D0, D1 | PLANNED-LATER |  |
| N45 | "Quiet over 90 days: 100%" and "never engaged: 52,926" look wrong | F1 | PLANNED-LATER |  |
| N46 | Zero invalid emails and phones across 52,926 contacts is implausible | F1 | PLANNED-LATER |  |
| N47 | Source data is 99% "Unknown" | F1, F2 | PLANNED-LATER |  |
| N48 | "Same person in several client accounts (23)" is a privacy problem | S0.2b, F1 | DONE-TONIGHT | S0.2b: card, query, tile and count removed, nothing compares people across clients; meeting matching never picks between clients (docs/features/S0.2b.md items 1, 19, 20) |
| N49 | Tags: what do they mean, and can I see the leads that were tagged? | F10 | PLANNED-LATER |  |
| N50 | Lead side panel, the Kit model | D0, F10 | PLANNED-LATER |  |
| N51 | Leads as a working surface | F10 (read-only part), W1 (never tonight) | PLANNED-LATER |  |
| N52 | Light and dark mode, and following the agency's brand | D0, D1 | PLANNED-LATER |  |
| N53 | Call lists should actually support calling | F10 | PLANNED-LATER |  |
| N54 | Call lists fail with a 504 | F10 | PLANNED-LATER |  |
| N55 | Third-party dialers, for example Kixie | F10 | PLANNED-LATER |  |
| N56 | Accounts versus Clients: same rows, two pages | C1 | PLANNED-LATER |  |
| N57 | Client billing health: who has paid, who is defaulting | R1 | PARKED | needs financial scopes and evidence first |
| N58 | Clients > Details: what is it for? | C1, F5 | PLANNED-LATER |  |
| N59 | Client requests (support tickets) | C1b (never tonight) | PLANNED-LATER |  |
| N60 | Compare two is weak, and what is the QBR for? | C1 | PLANNED-LATER |  |
| N61 | Team module: a real directory with activity | T1 (never tonight) | PLANNED-LATER |  |
| N62 | More observations | F1, C1 (observations) | PLANNED-LATER |  |
| N63 | Setup is thin: it needs a real checklist system | C1, D0 | PLANNED-LATER |  |
| N64 | "Why is an API marked unavailable when it is available?" and "turn on all scopes" | F1 (capability matrix), F8 (scope experience); release in Z2 (King) | PLANNED-LATER |  |
| N65 | Email sender health: vague, no data | E5 (never tonight) | PLANNED-LATER |  |
| N66 | Reselling profit dashboard | R1 | PARKED | waits for evidence |
| N67 | Duplicates: no filters, no cause, no source | C2 (never tonight) | PLANNED-LATER |  |
| N68 | Duplicate labels mean nothing to non-technical users | C2 | PLANNED-LATER |  |
| N69 | The duplicate score is wrong when names differ | C2 | PLANNED-LATER |  |
| N70 | Merging from SubSync: possible, but only with a clear plan | C2 | PLANNED-LATER |  |
| N71 | Data cleanup: what is it for? Merge Duplicates into it | C2 | PLANNED-LATER |  |
| N72 | Compare setups and Industry playbooks (King did not comment) | C1, D1 | PLANNED-LATER |  |
| N73 | Observations on these screens | S0.2b (N48), C1, C2 | PLANNED-LATER |  |
| N74 | Freshness: two statements, and only one can be the truth | S0.4, D0 | PLANNED-LATER |  |
| N75 | Trust for a Nigerian-built product selling abroad | F8 (Trust page); Z2, Z3 (King) | PLANNED-LATER |  |
| N76 | Settings: one long page, and it needs advanced features | F8, D0, D1 | PLANNED-LATER |  |
| N77 | Meeting notes privacy and how meetings work: what each setting does, and a contradiction | F8 (wording), E2a | PLANNED-LATER |  |
| N78 | Speed to lead settings: who does the replying, and is it working? | F2 | PLANNED-LATER |  |
| N79 | Slack: do we still need the pasted web address? Notification options and editable copy | F9 | PLANNED-LATER |  |
| N80 | "Send at" cannot work with a once-a-day refresh | S0.4, F9 | PLANNED-LATER |  |
| N81 | Connection health and Data sync cards | S0.4, F8 | PLANNED-LATER |  |
| N82 | Links: the login address is a manual field | S0.2b (item 4) | DONE-TONIGHT | S0.2b: domain found at sign-in and in the install event, stored per company, Settings field is only an override (and a save no longer freezes it); wording scan widened. NOT VERIFIED LIVE: a real signed install event (docs/NEEDS_KING.md section 13) |
| N83 | "What we store" and "Delete my data": good for trust, but check they are true | S0.2b, F8 | DONE-TONIGHT | S0.2b: src/lib/data-inventory.ts checked against the live schema, Settings card, privacy page and help text produced from it, uninstall and Delete my data tested against real rows, Delete my data owner-only with typed word and audit entry. The Trust page wording stays with F8 |
| N84 | Client access: the promise must be proven | S0.2b, F8 | DONE-TONIGHT | S0.2b: tests/unit/client-access.test.ts and the N84 block of scripts/check-tenancy.ts (two real companies, secrets searched in every client answer, access off is immediate); found and fixed two leaks. F8 only re-words the promise |
| N85 | Brand settings exist | F8, F6, D1 | PLANNED-LATER |  |
| N86 | Roadmap page: how does "Coming next" work, does it notify me? | F8 | PLANNED-LATER |  |
| N87 | Getting started needs a real guide, and a feedback field | F8 | PLANNED-LATER |  |
| N88 | Operating principles for Claude Code (applies to every stage) | CLAUDE.md principles | NOT-A-CODE-ITEM | operating principles, saved in CLAUDE.md |
| N89 | UI/UX revamp needed on Settings and What's new too | F8, D1 | PLANNED-LATER |  |
| N90 | Status of the old work | none (status note) | NOT-A-CODE-ITEM | a status note |
| N91 | Zoom connect fails: "Zoom did not say who signed in" | E0 (copy), E1 later | PLANNED-LATER |  |
| N92 | Slack connect fails again, and Connections is stuck on "Waiting for you..." | E0, F9 | PLANNED-LATER |  |
| N93 | "If nobody in a meeting is a known contact, save it in [client account]" makes no sense | S0.2b, E0, E2a | PLANNED-LATER | S0.2b part DONE: setting removed everywhere, stored value migrated (backup and counts in docs/features/S0.2b.md), tested that no path writes a meeting to a contact not matched by exact email. The private Meeting inbox is E0 and E2a |
| N94 | Connections must be personal, not assigned by the agency | E0 | PLANNED-LATER |  |
| N95 | Every role must be able to connect | E0 | PLANNED-LATER |  |
| N96 | Where to save: contact note or conversation comment, and note size limits | E0, E2b | PLANNED-LATER |  |
| N97 | What to save: recording, transcript, summary, both, or custom | E2b | PLANNED-LATER |  |
| N98 | Several sales teams | E0, F9, F10 | PLANNED-LATER |  |
| N99 | Our own writes can distort our own numbers | E0 (with F2 and F4 tests) | PLANNED-LATER |  |
| N100 | CFO view: scope and order for meeting notes | none (CFO view) | NOT-A-CODE-ITEM | scope advice, already applied in the roadmap order |
| N101 | Zoom facts to design around | E1 (never tonight) | PLANNED-LATER |  |
| N102 | Consent and sensitive content | E0, E2a, E2b, F8 | PLANNED-LATER |  |
| N103 | Prove the code really reads and writes the live Supabase database | E0, E2a | PLANNED-LATER |  |
| N104 | Fathom data into custom fields, and who configures what | E0, E2b | PLANNED-LATER |  |
| UX-01 | [S1] Win rate and forecast built on 6 closed deals | F1 | PLANNED-LATER |  |
| UX-02 | [S1] Two different open pipeline numbers | F1 | PLANNED-LATER |  |
| UX-03 | [S1] Meeting notes page states something no longer true | F8 | PLANNED-LATER |  |
| UX-04 | [S1] First screen headline is one test deal | F1, F5 | PLANNED-LATER |  |
| UX-05 | [S1] Agency user opened inside a client account lands on the agency view | F5 | PLANNED-LATER |  |
| UX-06 | [S2] Sync-running banner on almost every load | S0.4 | PLANNED-LATER |  |
| UX-07 | [S2] Clipping at narrow widths | D0, D1 | PLANNED-LATER |  |
| UX-08 | [S2] Clients page mostly n/a | C1 | PLANNED-LATER |  |
| UX-09 | [S2] Visual sameness | D0, D1 | PLANNED-LATER |  |
| UX-10 | [S2] Too much text before the content | D0, D1 | PLANNED-LATER |  |
| UX-11 | [S2] Navigation has 20 items | D0 | PLANNED-LATER |  |
| UX-12 | [S2] Call lists spins for more than 5 seconds | F10 | PLANNED-LATER |  |
| UX-13 | [S2] Persistent filter bar pushes content down | F5, D0 | PLANNED-LATER |  |
| S3-a | [S3] Team shows unresolved names (Team member ZWol) | F2 (N21) | PLANNED-LATER |  |
| S3-b | [S3] Duplicates tile shows a scary exact-match number from test data | C2 (never tonight) | PLANNED-LATER |  |
| S3-c | [S3] Meeting notes explainer uses numbered steps for tools most users lack | F8, E2a | PLANNED-LATER |  |
| S0-none | [S0] No S0 blocker confirmed in the review (nothing to fix) | none | NOT-A-CODE-ITEM | the review found no S0 |
