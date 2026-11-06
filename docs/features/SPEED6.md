# Speed to lead, sixth pass (stage SPEED6, branch `stage/speed6`)

King's direction: a sci-fi control room that stays simple. Deep navy, thin luminous borders, glow only on what is active or urgent, 150 to 250 ms motion, colour with meaning (cyan action, amber near breach, red breach, green good) and never alone (every state also has a word or an icon), reduced motion respected. Scoped to the Speed page (`.s6` in `speed6.css`); no other page changes.

## Part 1: restyle and clarity
| Piece | Where | Notes |
|---|---|---|
| Cards named as questions ("Who is slow?", "Who should I reply to first?", "Where do my leads go?", "Why do leads wait?") | Pace, People, Rules | one line under each, the explanation is behind the (i) |
| `Fold` | every tab except Race and Call mode's own screens | first 3 cards, the rest behind **More**; a card that only says it has no data is hidden and counted in one line "N more cards need more data". It reads the cards a tab already draws, so old tabs get the rule without being rewritten |
| Animated lead journey | Pace | one dot per share of leads; dots that stop early fall into labelled drop-off buckets; Replay; a step or a bucket opens its people in the side popup (the old step list stays under More) |
| Ready to act now | Pace | open money first, then days waiting; red "Next step: none set" when nobody touched the lead and no appointment exists; Reply opens the shared lead panel |
| Closing velocity, new leads by day, first replies by day, main reasons leads wait | Pace (More) | `GET speed?part=pulse` (`speed6-queries.ts`); velocity needs 5 booked leads |
| Person table with an Unassigned row | People | every number opens its people (first 40 shown, the count says so) |
| Delay-reason chip | every lead list (`LeadRows`) | no owner, owner busy, after hours, duplicate, no phone, do not contact; first match wins; tooltip says why |
| Rules | Rules | reply target stepper, escalation toggle with two small inputs, digest card with a plain-text preview popup and a dry-run Send test, "Which leads are waiting now?" cards (step badge, who is told, Reply opens the lead panel), response-speed proof as compact per-client cards (printable page unchanged, hidden on screen) |
| First-run tour, "What can I do here" guide | page header | tour is 4 short steps, remembered in the browser |

Rules (pure, `src/lib/analytics/speed6.ts`, tests `speed6.test.ts`): delay reason order, owner busy = at least 3 waiting and 1.5 times the team average, journey dots (buckets plus last step equal the leads), day counts, velocity (median days, 5 booked leads minimum), person table (rate needs 5 leads), ready score.

## Part 2: Call mode v2
Pure rules `src/lib/dial/dial6.ts` (tests `dial6.test.ts`): redial cadence ("touch 2 of 4", wait N hours or next morning, max tries, then a text task), lead-local call windows (9:00 to 20:00 in the lead's zone; a closed window skips the lead and says "call at 9:00 their time"), best hour to call (12 calls minimum), heat score that re-ranks the remaining queue after every outcome, custom dispositions with next steps and tags, plain-template booking text and call note (no model call), script per lead source, power hour (timer, goal rings), the setter board (tiers Orbit, Surge, Spark; its own palette; fastest marked), conversion by attempt number.

Screens: "Who do I call next?" with lists (missed calls, new leads, hot leads, **No-show saver**, **Redial list**, saved filters) and **Today's callbacks**; Start calling or **Power hour**; redial plan card; best time; which attempt books; agency view of dialing per client; the animated board (a client's staff see only their own rank).

Server: `GET dial/insights`, `GET dial/detect`, redial list source and `source` on queue items (`dial6-queries.ts`, `dial-routes.ts`). Reads only metadata of calls logged in Call mode.

### Auto outcome sync (no re-selecting outcomes)
The rep calls from the CRM; SubSync reads what the CRM recorded and logs the outcome itself (`src/lib/dial/autosync.ts`, tests `autosync.test.ts`).
- Signals: the call record on the contact (status and length), tags added or removed, a stage move, a new appointment, do-not-disturb. They come from the webhooks already received (`OutboundMessage` into `touch_events`; the call length now rides in the same outcome word, "completed:134", no new column) and the tables SubSync already keeps (`lead_events`, `cached_appointments`, `cached_contacts`).
- Inference: answered over 30 s = Spoke; no answer, busy, failed, cancelled = No answer; voicemail = Left voicemail; an appointment or booked tag = Booked; do-not-disturb or do-not-call tag = Do not call; wrong-number tag = Wrong number (the account's own outcome tags are honoured). CRM actions win over the call record.
- When: pressing Call starts a check of that one lead every 10 s for 2 minutes, and an immediate check whenever the tab regains focus. A sure result is logged, the next lead appears, a toast says "Spoke with Ana, 4 min" with **Undo / change** and an "auto-synced" mark. A short or unmeasured call asks "How did it go?" with the likely chip preselected; no call found after the rep returns also shows the chips. Setting: **Auto-detect calls (recommended)** (on by default, kept in the browser). Off = the manual outcome buttons, nothing polled.
- No double writing: SubSync's own CRM note is skipped when the CRM already holds the call; a tag the rep set in the CRM is not written again; each detection is acted on once. Writes stay a dry run while the write switch is off.
- Undo / change logs a corrected outcome (the newer one wins); SubSync's earlier record is not deleted.

## Honest limits (NOT built or NOT verified)
- Detection reads SubSync's webhook-fed tables, not the CRM live: the "poll" asks SubSync every 10 s, so a call is seen as fast as the webhook arrives. A live fetch of the one conversation needs a location-token helper wired into the dial routes (not done). The CRM's call message must carry a duration and status in the webhook payload (field names `duration`, `meta.call.duration`, `status` are assumed, CHECK on a real call).
- No new scope: `conversations/message.readonly` stays optional and is not used by this path.
- The CRM's own do-not-disturb flag cannot be set through the gateway (no such action): "wrong number" and "do not call" add a tag and skip the lead in SubSync.
- Stored in the browser only (not shared across devices): cadence, goals, booking link, scripts per source, outcome sets per account, promised callbacks. A table for callbacks and settings would be an additive migration (not written). The attempt counts themselves are server-side (touch_events).
- Team ranks for a client's staff "only if the agency allows" has no setting yet: staff see only their own rank.
- Race feed rows carry no delay-reason chip (lists do). Histogram bars are not clickable (no per-day list query).
- Migrations: none added. No scope, Vercel, Supabase change.
