# Find a lead (R1, 11 Nov 2026): what agencies need, what GHL lacks, what we hold

Labels: VERIFIED = read on the page or in this repo; INFERENCE = my reasoning; UNVERIFIED = secondhand or a snippet only. Web research was one search; the official help centre was not reached.

## 1. What GHL gives natively, and the gaps
- Smart Lists are saved filter sets per account; AND/OR logic; members are automatic. UNVERIFIED (vendor guides): https://growthable.io/gohighlevel-tutorials/contacts/and-or-filters-in-gohighlevel/ , https://consultevo.com/gohighlevel-smart-lists-guide/
- Large lists are slow: a user request says "Next" paging fails past about 80k records. UNVERIFIED (one feature request): https://ideas.gohighlevel.com/smartlists?sort=new
- No segment-style logic (nested groups) and no "assigned to = current user" dynamic filter; both are open requests. UNVERIFIED: https://ideas.gohighlevel.com/smartlists/p/smart-lists-allow-assigned-to-current-user-as-dynamic-filter
- Smart Lists are per account; a list a user did not share may be invisible to an admin. UNVERIFIED (help article, maybe outdated).
- Cross-account search for an agency: NOT FOUND in the search. INFERENCE: an agency user opens each account to search it. This is the main gap SubSync fills.

## 2. Competitors (INFERENCE from the product categories; prices not re-checked)
- Per-account CRM search (HubSpot, Pipedrive) is fast but single-CRM; agencies cannot span 50 client CRMs.
- Dialer tools (Kixie, Aloware) list people to call but read their own phone data.
- Client reporting tools (AgencyAnalytics) have no lead search. Nobody found searches leads across all client accounts with team-shared lists.

## 3. What the team needs (INFERENCE; confirm in King's owner interviews)
1. "Where is this person?" One box, any account: name, phone digits, email. Under a second.
2. Narrow by tag, source, owner, stage, quiet days, account, without scrolling 300 tags or 50 accounts: typed pickers.
3. Saved lists shared with the team (exists: people-team saved views).
4. Who is this person: messages, calls, appointments, deals, notes, tags (exists: the lead panel).
5. Act on many at once with a preview: tag, note, change owner (exists in Team actions), export.
6. Never hide anyone: do-not-disturb people are shown with the reason; they are never messaged or deleted.

## 4. What we hold (VERIFIED, repo)
`cached_contacts` (name, email, phone, tags, source, assigned_to, dnd, date_added, last_activity_at) with trigram indexes on name, email, phone; tags GIN; (installation, location, last_activity) index. Plus `cached_conversations`, `cached_appointments`, `cached_opportunities`, `call_outcomes`, `contact_tag_events`, `saved_views`. Custom fields are NOT stored (live read per lead).
Not held: message text (by design). So search by message words is not possible.

## 5. Gaps found in our own screen
- Paging used an offset (page 5,000 reads and drops 250,000 rows). Fixed: keyset.
- Long pickers were plain selects (tags cut at 150). Fixed: typed pickers, 300 tags.
- Rows had no shared Open button; no bulk; no export. Fixed (flags fl_find, fl_bulk).
- No owner index. Added (one partial index).

## 6. Risks
Formula injection in exports (fixed: cells starting = + - @ are prefixed). Bulk writes: capped at 50, preview then confirm, through the same gateway as one tag or note. The 500 MB database: one index only. Search time at 1M to 20M rows is UNVERIFIED on live data (tested on a 150-row fixture); the first-page count is capped at 10,000 and a 10 s statement limit protects the database.
