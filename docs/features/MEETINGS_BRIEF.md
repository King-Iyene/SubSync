# Meeting notes (Fathom) build: one integrated builder brief

Rules: docs/features/CLIENTS_BRIEF.md and the briefs it points to apply in full (list in TODAY_BRIEF.md first paragraph), plus CLAUDE.md operating principles 11 to 14 (connection ownership, certain matching only, echo guard). Read: docs/research/MEETINGS_R1.md, docs/INTEGRATIONS_SPEC.md, docs/features/CONNECTIONS.md, src/lib/connections/*, views/meetings.tsx, meeting-inbox.tsx, meeting-setup.tsx.

Goal: a call held becomes a note, tasks and a visible next step on the right contact, with no copy and paste, and owners see calls held but not logged. Lowest money priority: polish and validate with pilots, then extend.

## Evaluation (principle 1)
(a) Decision: the closer or setter (own calls) and owner (counts only) decide whether the call is logged and what the next step is. Missing: "I write the same note twice". (b) Data: Fathom webhooks with transcript, summary, action items (VERIFIED, developers.fathom.ai/webhooks); read-only API; CRM note and task writes need the optional contacts write scope (off until reconnect). NOT available: other people's recordings without their own connection; our dialer's audio. (c) Notetakers sync to big CRMs; GoHighLevel not first-class (INFERENCE, verify on fathom.video); agencies use Zapier. (d) Simplest: match by exact email or phone, else a private inbox. (e) Risk: wrong contact (privacy breach), duplicate webhook, cross-client leak, echo.

## Slices
1. **Verify live on one real meeting** (King's own Fathom): idempotent on recording id, signature check, matching rules, inbox, note write behind preview; record in docs/features/CONNECTIONS.md.
2. **Next step and action items:** action items become CRM tasks only after a preview and confirm per person, assignee mapped by exact email, never guessed; caps and undo; through the gateway.
3. **Calls held, not logged:** per rep and per account counts (calls with a match but no note, calls in the inbox over 24 h), clickable, equal to rows; owners see counts never content (rule 12).
4. **Meeting-to-outcome link (moat, history first):** append-only `mn_outcomes` (account, day, meetings held, logged within 24 h, next step set, deal moved or booked within 7 days), ids and counts only; show only with minimum 30 meetings, labelled "history starts <date>"; do not claim a conversion lift before the data supports it.
5. **Setup health:** per-user connection status, "Needs permission: reconnect", expired tokens, last webhook seen.
6. Zoom and Google Meet stay deferred until a pilot asks (INTEGRATIONS_SPEC.md).

## Safety
One connection per user; tokens never visible to anyone else; no shared or agency-assigned connections; a meeting reaches a contact only when matched with certainty; one client's meeting never lands in another account. Deleting a note or disconnecting needs a typed confirmation naming it. Our notes are tagged and excluded from reply, activity and engagement metrics and from webhook echoes.

## Scale and tenancy
Webhook handlers idempotent and queued; keyset paging of the inbox; first screen under 2 s; tenant guard on every location id; xtest- cross-tenant test for matching and inbox.

## Customer's-eye check (required)
Closer: "is my call on the right contact, can I fix it in one click". Owner: "who is not logging calls". Words: "Waiting for you to pick the contact". Pilot question: do your closers use Fathom? Record in docs/NOTES_COVERAGE.md or the connections review.

## Setup
Worktree C:\Users\KING\wt\MN, branch stage/mn, port 3646. Flags `mn_tasks`, `mn_logged`, `mn_outcomes`. Migrations from 20261209090000 (`20261209090000_mn_outcomes.sql`). Tests: duplicate webhook, signature, exact-match-only, no cross-tenant leak, echo exclusion.

## Extras to list
"Copy note for the client"; daily "calls to log" line in the Today email; per-rep reminder before 24 h.

## Done when
Flags ON, verified with a real meeting and real roles in a browser, why-would-I-pay pass written (and honestly "weak alone" if pilots do not use Fathom).
