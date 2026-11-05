# Speed to lead, third pass (stage SPEED3, branch `stage/speed3`)

Same look as Today (`today` theme, `t-*` type, `TimeChart`, "?" tips). Tabs: **Replies** (the existing queue), **Pace**, **People** (client staff see **Owners** only), **Lead capture**, **Alerts**.

## Acting on a lead without leaving Speed
Every **Reply** button, and "Reply to the oldest waiting lead", opens a side sheet (bottom sheet on a phone): text, email or WhatsApp, templates with merge fields (server), preview, then Send. Also: note, task for tomorrow, tag, **Give to the person who replies fastest**, and **Delete this lead** (owner side only, typed name). All of it goes through the lead workbench gateway (`src/lib/ghl/workbench.ts`, `workbench-routes.ts`, `ds/wb/runner.tsx`), which was **taken verbatim from `stage/moat`** (identical files, so the later merge is clean) plus the route and access lines. `WRITE_GHL_LIVE` off (and the demo, always): the sheet shows the preview and records "would send"; nothing leaves. Open in your CRM moved to the row menu.

## What each card says (one line of money argument each)
| Card | Money argument |
|---|---|
| Worth the most if you reply now (lead rescue) | Ranks waiting leads by the open-deal dollars of those people, halved for every day of cooling: reply where the money is first. |
| Does answering fast book more? | The account's own bookings for leads answered within 5 minutes against later, a multiple only from 20 and 20 leads: the proof that makes a client hire cover. |
| First reply against your normal | Slow drift is felt by clients long before a report shows it; needs 5 replies a week and 3 earlier weeks. |
| When leads arrive and nobody answers (after-hours gap map) | Shows the exact weekday and hours to staff, and the leads lost at night and weekends. |
| By lead source (speed, booked, showed, won, slow cost) | Dollars slow replies cost each source, from that account's own average deal and win rate (20 closed deals minimum). |
| Leads nobody owns, owner spread | An ownerless lead is answered by no one; one-tap give to the fastest replier; overloaded owners flagged. |
| Who replies (setter scorecard) | Typical time, in time, replies, booking rate per person; compared only with colleagues in the same company. |
| Lead capture (counters, chart, gross against unique, sources, league, drop or rise) | A form that breaks shows as a fall in email leads days before the client calls. |
| Alerts and digest preview | Reply target, who is told (Settings and Alerts), a daily or weekly digest as text, printable for a client: proof of "we reply in N minutes" for retention. Nothing is sent. |

## Counting rules
Unchanged from Today (`docs/METRICS.md`): a lead is a new contact with a conversation; waiting is judged against the account's target. New pure rules in `src/lib/analytics/speed-v3.ts` (tested in `src/lib/__tests__/speed-v3.test.ts`): every mark and its list use one function (`pick`), so count equals rows. Minimums: 5 for a typical time or rate, 3 replies per person, 20 and 20 for fast against slow, 3 earlier weeks for a normal, 10 owned leads and 2 owners for "overloaded". After hours = weekend, before 8 or from 18 in the account's own time zone (UTC when unknown). booked = an appointment not cancelled that starts after the lead arrived; showed = marked showed; won = a won deal.

## Endpoints
`GET /api/app/speed?part=insights` and `part=insight-list&sel=all|after|open|cell|source|fast|slow|week|noOwner|person|owner` (strict allow-list; person and owner only for people who may see people; account ids narrow inside the caller's own accounts). Workbench: `GET workbench/context|thread`, `POST workbench/preview|do`.

## Not built (no data, or belongs to another module)
Missed calls with no follow up, missed-call text-back audit, best time to call, text delivery health, promised callbacks, lead quality score, ball in whose court and inbox balance, channel mix, funnel drop-off percentages, duplicate-lead guard before replying, routing sanity check, instant templates per source, best send time and email fatigue: they need call, delivery or outbound-message history SubSync does not store yet. Lead life story is the existing lead panel (timeline). Today's Growth tab still has its own email counter; it was **not removed** from Today (Today's tests and the Records panel use it); Speed's Lead capture reads the same `today/growth` answer.
