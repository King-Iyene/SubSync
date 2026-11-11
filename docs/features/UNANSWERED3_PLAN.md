# Unanswered messages, round 3 plan (10 Nov 2026) - branch stage/unanswered3

Buy-test for every item: an agency owner pays $11.50 per client account because this saves or proves money. Nothing ships on by default. Every CRM write goes through the safe write gateway (preview, typed confirm for delete, dry-run until WRITE_GHL_LIVE and the account opt-in).

## Evidence (research, 10 Nov; reviews not found, so demand is INFERENCE until pilots confirm)
- GHL has no cross-account inbox (ideas board: a team keeps 40+ tabs open). Its reply timer only changes colour, runs on calendar hours, per account, no alert.
- Closest rival: Hot Prospector free "Instant Audit" (grade, revenue-loss estimate). It shows no peer comparison and keeps no history.
- Nobody publishes measured benchmarks by vertical; the numbers in circulation are old one-off studies.

## A. Moat (depends on our own history, hard to copy)
1. **Rescued revenue receipt (build first).** Every alert we raise, who replied after it, how long it took, and whether an appointment or deal followed. Monthly receipt per client: "N leads were saved after an alert, M booked, estimated $X" with the formula one tap away. Works with ONE agency, needs no cross-tenant data, and the history cannot be rebuilt later by a competitor. Uses the event store plus `unanswered_outcomes`.
2. **Collect now, show later:** an optional vertical tag per client account (med spa, solar, home services, real estate, coaching) and reply-time facts, so benchmarks unlock when there are enough agencies.
3. **Vertical peer benchmark (later, needs 15+ agencies per group):** "Your median reply 41 min; med spas on SubSync 18 min." Opt-in, anonymised, minimum cohort size, never any other tenant's data. Needs a written privacy decision from King first.
4. **Setter scorecard with trend** (median, P90, unanswered share, after-hours, week on week). Builds on 1 and 3.
5. **Verified reply-time page for the client** (agency-branded, measured not self-reported, no guarantee wording, no vendor words). Later.

## B. Actions (write, update, delete) - each one removes a daily pain
1. **Snooze / handled** (SubSync only, reversible, with a reason). No CRM write.
2. **Assign owner** to an ownerless thread (CRM write, optional scope, preview, confirm, audit log, undo note).
3. **Add internal note** (CRM write; the note is excluded from our own reply metrics, rule 14).
4. **Clear junk:** delete only conversations the user selects, typed confirmation, never for contacts that are DND, or have an open deal or upcoming appointment.
- Skipped on purpose: reply from SubSync (consent risk, CRM already does it; we link to the thread).

## C. Redesign to the Speed standard
Control-room look, cards named as questions, a fold of 3 cards with the rest behind More, every count of people clickable, light and dark, phone 390 / tablet 768 / desktop 1440. Match `src/app/app/views/speed.tsx`.

## D. Base to fix first
- Breach alert database test (helper running).
- Run the missing migrations check, then the tenancy sweep alone before anything merges to main.

## Update after deep research (see docs/research/UNANSWERED_RESEARCH_SUMMARY.md)
Order changed: (1) ownerless conversations plus a setter Claim button (top verified pain, 99 votes), (2) Rescued-revenue receipts and the speed-to-outcome curve (start recording raw timestamps and a vertical tag now), (3) hide spam and internal contacts by default instead of building delete (GHL is shipping native spam marking; delete stays narrow and later), (4) snooze, note, (5) redesign, (6) benchmarks only after 15+ agencies and a privacy decision.

## Order (old, superseded)
D (base) -> A1 rescued revenue + A2 data collection -> B1 snooze -> C redesign -> B2 assign -> B3 note -> B4 clear junk -> A4/A3/A5 later.

## Not tested on a real CRM account
Everything. King's throwaway-account test is still pending.
