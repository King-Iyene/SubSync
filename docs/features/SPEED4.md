# Speed to lead, fourth pass (stage SPEED4, branch `stage/speed4`)

## Identity (read this first)
1. **Speed to lead is THE RACE ON NEW LEADS**: the clock from the moment a lead arrives (form, ad, call, chat) to the first human touch.
2. It answers three questions: is the team winning that race, who or what is losing it, and what that costs in money.
3. **Unanswered messages** (the Inbox) is a different thing: existing conversations where the customer spoke last, any age. A backlog inbox.
4. Speed is about arrival, first touch and the clock. Unanswered is about a pile. They never show the same list.
5. One line links them: a lead that has had its first touch and then goes quiet belongs to Unanswered; a lead nobody has touched yet belongs to the Race.
6. Money is shown as counted deals (facts). An estimate appears only for an account with 20 or more closed deals, and says "estimate".

## The money story (each in the order King set)
| Card (where) | Dollars |
|---|---|
| Money leaking (Race headline) | Leads this month with no person touch or a slow one; open deals of those people counted; estimate = leads x the account's own average deal x win rate (20 closed deals minimum). |
| Missed-call recovery (Coverage) | Missed calls with no callback or text within 15 minutes, ranked by the caller's open deals; one-tap Reply (text) and Call from the row. |
| Lost at night (Coverage) | After-hours and weekend leads with no person reply in 12 hours: counted deals, estimate, and the weekday and hours to cover. |
| Agency proof (Rules) | Printable "Our response speed" per client: median first reply and share in time, this month against last; no product name. Keeps clients. |
| Unowned leads (Race feed) | One-tap "Give to <fastest replier>" through the write gateway (preview, confirm, dry run while writes are off). |

## Tabs
Race (headline, speed ring, live clocks, new-lead feed, life story per lead), Pace (lead journey, response curve, cost per source, trend, after-hours map), Coverage (missed calls, text-back audit, lost at night, best time to reach, channel mix and delivery health), People (setters, owners), Capture (email leads), Rules (reply target, alerts and digest preview, routing check, printable report), Log (the earlier queue and charts, kept).

## The durable data layer (migration `20261109090000_touch_events.sql`, additive, NOT applied)
- `touch_events`: one row per message or call. Metadata only: contact, direction, channel, kind (message, call, missed_call, failed), outcome word, user, automated yes/no, time. **Never the words.** A column-name check (data inventory) and a test fail if a text column is ever added. A per-account opt-in to keep text is reserved (`settings.speed_keep_message_text`, default off) and nothing reads it.
- `lead_events`: lifecycle SubSync records itself (arrived, owner changed, stage moved). Appointment status, tag and deal changes stay in `appointment_events`, `contact_tag_events`, `deal_events` and are read together in the life story.
- `speed_daily`: one row per account per day (response buckets, counts by channel, source, owner, hour, missed calls, text-backs, failed sends). Rebuilt nightly by the metrics job.
- Ingestion: webhooks (InboundMessage, OutboundMessage, ContactCreate, OpportunityAssignedToUpdate, OpportunityStageUpdate) and the speed sync write idempotently (unique event key). Backfill: a few conversations per sync run read back 30 days. Nightly reconcile: the rollup is rebuilt for 35 days and events older than 400 days are removed.
- Tenancy and deletion: tables are in `tenant-tables.ts` (deleted on uninstall and per account) and `data-inventory.ts`. Every read is bound to the caller's accounts; filters only narrow.

## Filters
One Filters button on every Speed tab: status, first-reply time, weekday, arrival hours (overnight allowed), channel used, source, tag; saved filters (kept in the browser). Campaign is in the filter type but not populated: no campaign field is stored yet.

## Counting rules
Pure functions in `speed-v4.ts`, `speed-v4-more.ts`, `touch-events.ts`; tests in `src/lib/__tests__/speed-v4.test.ts`. Minimums: 5 judged leads for a score or typical time; 5 missed calls for a text-back share; 10 tries and 5 answers in an hour to rank it; 20 sends for a channel rate and a winner; 10 owned leads for the routing check; 2 leads in a weekday-hour to call it an hour to cover. Every journey step list uses the same function as its count.

## Not built
Promised callbacks (needs message text, which is never stored), per-source reply targets (needs a new setting), campaign filter data, owner filter control (the filter is in the address only), a partitioned `touch_events` (indexed by installation and time instead). Lead quality is a starting guess from phone, email and source.
