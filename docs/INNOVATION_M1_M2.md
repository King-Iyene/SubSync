# Innovation pass (Prompt D), milestones M1 and M2

Written 3 Nov 2026 by a read-only analyst. **Three PROPOSALS. None is built, and none will be built until King says yes** (`docs/PROMPTS.md`, `CLAUDE.md` operating principle 4). Prompt D: improvements beyond the roadmap that fit the wedge (alerts, speed to lead, show rate, setter ops), each with the customer benefit, effort, existing data reused, and a recommendation.

**Labels.** VERIFIED means read in code or a migration, with `file:line`. INFERENCE means reasoning that could be wrong. Effort: S under 2 days, M about a week, L more.

**Filters I applied.** (1) `CLAUDE.md` section 1A: detecting a problem and auto-replying are not our differentiators, so nothing here claims them, and nothing sends a message to a lead. (2) Nothing needs a new scope. (3) Everything reuses tables that already exist. (4) Brief section 8 defers client portals, white-label reports and custom report builders, so I left out anything that looks like one. (5) Nothing duplicates a roadmap stage: Setter and closer performance is T1, anomaly detection against an account's own normal is on `docs/MOAT.md` section 2, safe write actions are W1, benchmarks are R1.

---

## Proposal 1 (recommended): Alert outcomes, "fixed, dismissed or faded"

**PROPOSAL. Waiting for King's yes. Not built.**

**What is wrong today (VERIFIED).** An alert is stamped resolved in two ways, and neither says why. The sync resolves any open alert whose key is not raised again (`src/lib/analytics/queries.ts:560-562`), which also happens when the problem simply left the 30-day window or the account was switched off. A person pressing Dismiss does the same (`queries.ts:596-598`). The quarterly review then counts every resolved row as "sorted out" (`src/lib/analytics/client-success-queries.ts:236`) and prints "N problems SubSync flagged were sorted out" under What went well (`src/lib/analytics/client-success.ts:556`, `src/app/app/views/clients/reviews.tsx:99,118`). A dismissed or aged-out alert is credited as a fix. That breaks operating principle 5 on a screen an agency prints for its client.

**The improvement.** Record how each alert ended and, where the data allows, verify the fix.
- **Dismissed:** a person pressed Dismiss (who, when).
- **Verified fixed:** the evidence is in our own tables after the alert was raised. Speed breach: each lead in the alert got a human touch (`lead_touches.human_touch_at` later than the alert). Unmarked appointments: a status event to showed or no-show (`appointment_events` kind `status`). No-shows not rebooked: a new appointment for the same contact. Unanswered messages: the conversation's last message is now ours.
- **Cleared, cause unknown:** it stopped being raised with no evidence either way. This is not counted as a fix.
Show per account and per agency: raised, verified fixed, dismissed, cleared, the median time to fix, and alert types that are always dismissed (a hint to change the threshold). The Receipts in `CLAUDE.md` section 1A ("what we caught, what was fixed") become provable instead of implied.

**Customer benefit.**
- **Agency owner (A):** walks into a client review with "31 problems flagged, 22 verified fixed in a median 3 h 10 min, 5 dismissed, 4 cleared with no sign of a fix" and can say which problems the team ignores. Next action: coach the person or change the threshold of an alert type that is always dismissed.
- **Setter (S):** sees which of the alerts on their own leads they fixed, which is the only "did my work count" signal they get.
- **Client admin (B):** sees proof that problems are being handled, for their own account only.

**Effort: M.** One additive migration (a new `alert_events` table, or `resolution` and `resolved_by` columns on `alerts`), a verifier that runs where the resolve happens (`queries.ts:544-565`), a new card in Reviews and on the audit, and a reword of "sorted out" to "cleared" until the verifier ships (tests that pin the old words: `src/lib/__tests__/client-success.test.ts:403,418,464`).

**Existing data it reuses.**
- `alerts` (`created_at`, `resolved_at`, `kind`, `dedupe_key`, `detail`; `supabase/migrations/20261029010000_feature_schema.sql:94-109`).
- `lead_touches` (`lead_at`, `human_touch_at`, `touch_user_id`; `20261031100000_speed_to_lead.sql:5-16`, `20261102030000_speed_f2.sql`).
- `appointment_events` and `cached_appointments` (`20261031070000_flags_and_events.sql:15-25`, `20261031030000_appointments.sql:4-19`).
- `notification_states` (`read_at`, `dismissed_at`, used at `src/lib/notifications/store.ts:163`) for "seen by whom and when".
- The QBR proof query `alertsOf` (`client-success-queries.ts:248-251`).

**Risks.**
- *Privacy:* ids, kinds and timestamps only, no message text; same as the tables above. Add the new table to `src/lib/tenant-tables.ts` and "What we store" (a test fails if a table holds data not listed, `docs/ROADMAP_V2.md` S0.2b item 3).
- *Scope:* none new.
- *Cost:* a handful of indexed lookups per resolved alert.
- *Accuracy:* "verified fixed" is only as good as `lead_touches` coverage, which needs the messages permission; where an account has not granted it, the outcome stays "cleared, cause unknown" and the screen says "Needs permission: reconnect". Rates only from 5 alerts, per the minimum-sample rule.
- *Native overlap (section 1A):* GHL does not record whether an alert led to a fix, and metric-change alerts in AgencyAnalytics do not verify one (INFERENCE from `CLAUDE.md` section 1A, which lists AgencyAnalytics as client reporting with metric-change alerts; not re-checked in the marketplace). This is a proof feature, not a detection or reply feature.

**Feeds the event-store moat: yes, strongly.** The cause and evidence of each resolution cannot be rebuilt later: once an alert row is resolved nothing records why. A year of "alert raised, fixed by evidence X after Y minutes" per account is a record a newcomer cannot buy.

---

## Proposal 2: Coverage gaps, when leads arrive versus when anyone answers

**PROPOSAL. Waiting for King's yes. Not built.**

**The improvement.** A grid of weekday by hour, in each account's own time zone, showing how many new leads arrived in that slot and how many were answered by a person inside the target. Slots with a cluster of breaches are named in plain words: "Saturday 6 to 9 pm: 11 leads, 0 answered inside 15 minutes." It turns a breach alert (a symptom) into a staffing or routing decision (the cause). It replaces the after-hours card that the simplify pass proposes to cut (`docs/SIMPLIFY_M1_M2.md` cut 4), which only counts when contacts are created, not when anyone replies (`src/app/app/views/comms-sections.tsx:10-31`).

**Customer benefit.**
- **Agency owner (A):** decides to add a weekend setter, move a routing rule, or switch on a text-back workflow in the CRM for exactly the hours that fail. Next action: change staffing or routing (SubSync only measures, it never sends).
- **Client admin (B):** sees why leads go cold on weekends and what hours to cover.

**Effort: S.** One aggregate over rows that exist plus an existing grid component: the Appointments Insights heat grid (`src/app/app/views/appointment-insights.tsx:338`, colouring at :48-51, minimum of 5 per cell) and `localSlot` (`src/lib/analytics/appointment-deep.ts:12`) for local time.

**Existing data it reuses.**
- `lead_touches` (`lead_at`, `human_touch_at`, `auto_touch_at`; `20261031100000_speed_to_lead.sql:5-16`, `20261102030000_speed_f2.sql`).
- `judge` and `bySource` in `src/lib/analytics/speed-intel.ts:87,189`.
- The account time zone and business-hours settings (`validZone`, `clockStart` in `src/lib/analytics/lead-rules.ts:74-80`; `settings.speed_target_minutes`, `count_automated_touches`).
- `team_names` for who covers a slot (`20261102030000_speed_f2.sql`).

**Risks.**
- *Small samples:* a cell under 5 judged leads shows nothing, and the whole card waits for 4 weeks of data, matching the page's other minimums. On the real agency 10 leads were timed on 31 Oct (`docs/FEATURE_STATUS.md`, live check table), so it would be empty for a while.
- *Time zones and daylight saving:* reuse the tested functions above rather than new date maths.
- *Privacy and scope:* aggregates only, no new scope.
- *Native overlap:* response-by-hour reporting exists in dialer tools such as Kixie and Convoso (`CLAUDE.md` section 1A); GHL's own reports do not slice response time by hour (INFERENCE). Our claim is the hours and the cost, not detection.

**Feeds the event-store moat: partly.** It reads `lead_touches`, which already persists. It adds no new record, but a weekly snapshot per account would let it show "did the new weekend setter fix it" over time, and that comparison is only possible if snapshots start now.

---

## Proposal 3: Likely no-show ranking on "Remind today" and My day

**PROPOSAL. Waiting for King's yes. Not built.**

**The improvement.** Today the Remind today list is every unconfirmed appointment starting in the next two days (VERIFIED `src/app/app/views/appointments.tsx:75`), with no ranking. Rank it by how likely each is to be missed, with plain reasons the setter can read: "booked 2 hours ago from a Facebook form, not confirmed, missed twice before, no reply since booking." The first version is transparent rules that add up, not a model, labelled an estimate. Every flagged appointment is later compared with what happened, so the screen can say how often a flag was right.

**Customer benefit.**
- **Setter (S):** opens My day and calls the first three, the ones most likely to be lost, instead of working a flat list. Next action: call or text from the CRM.
- **Agency owner (A):** sees whether flagged appointments really no-show more, and which sources or booking channels produce the risky ones.

**Effort: M to L** (rules and reasons M, calibration and display L). Do the rules first.

**Existing data it reuses.**
- `cached_appointments` (`created_remote_at`, `start_at`, `status`, `booked_by_user`, `booking_channel`, `assigned_to`; `20261031030000_appointments.sql:4-19`, `20261102040000_f3_appointments.sql`).
- `appointment_events` for status history (`20261031070000_flags_and_events.sql:15-25`).
- The Insights functions `repeatNoShows`, `showRateBySource`, `confirmationSummary`, `heatmap` (`src/lib/analytics/appointment-deep.ts:57,134,149,29`).
- `lead_touches` or `cached_conversations` for "did the contact write after booking".

**Risks.**
- *Not provable on real data yet:* the real agency has 38 appointments, all from September, and none booked in the last 30 days (`docs/FEATURE_STATUS.md`, F3 and live-check rows). A flag cannot be calibrated until a few dozen outcomes exist, so this cannot be verified on live data today (operating principle 3).
- *Fairness and privacy:* behaviour only (timing, source, confirmation, past misses), never personal traits; contacts marked do not disturb are shown but never contacted (principle 8).
- *Overreach:* a rule-based score on small data can look more certain than it is, so the screen must show the minimum sample, say "estimate", and open the appointments behind each flag.
- *Native overlap:* reminder and confirmation workflows exist natively and we do not send; the ranking and its calibration are not a native feature (INFERENCE).

**Feeds the event-store moat: yes.** Store the score, reasons and time of each flag in a new additive table (`appointment_events.kind` is limited to created, status and time, so a new table is needed), then join with the final status from `appointment_events`. The accumulating "flagged versus actual" record is the base for the cross-agency benchmark in `docs/MOAT.md` section 3.

---

## Comparison

| | Customer value | Effort | Data ready today | Moat | Main risk |
| --- | --- | --- | --- | --- | --- |
| 1. Alert outcomes | Proof for the client review; fixes a wrong claim | M | Yes | Strong, unrecoverable history | Verification depends on the messages permission |
| 2. Coverage gaps | A staffing decision from speed breaches | S | Yes, but thin until 4 weeks | Light | Empty on small accounts |
| 3. Likely no-show ranking | A ranked call list for setters | M to L | Thin (38 September appointments) | Strong once calibrated | Cannot be validated yet |

## Recommendation

**Build Proposal 1, "Alert outcomes: fixed, dismissed or faded", if King says yes.** Reasons:
1. It corrects a claim that is already on a printed screen (the QBR "sorted out" count), which operating principle 5 forbids. It makes the Receipts in `CLAUDE.md` section 1A true.
2. Every table it needs exists and holds data today, so it can be verified on live accounts, unlike Proposal 3.
3. It records something that cannot be rebuilt later, which is the strongest moat argument in `docs/MOAT.md` section 1.
4. It needs no new scope and sends nothing.

If King would rather have the most visible quick win first, Proposal 2 is the smallest (S) and replaces a card the simplify pass cuts.

**Separate from the proposal and small enough to do now (working principle 5):** reword "sorted out" to "cleared" in the QBR until the verifier exists, and update the three tests named above. That needs no new feature and no King decision.

**Status: all three proposals are waiting for King's yes. Nothing has been built.**
