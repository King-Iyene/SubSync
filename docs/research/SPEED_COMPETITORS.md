# Speed to lead and Call mode: competitor research (6 Nov 2026)

Method: about 9 public fetches/searches (vendor pricing pages, a GHL dialer roundup), plus prior knowledge. Labels: VERIFIED = read on a vendor page this session; KNOWN = from memory of vendor docs, not re-read today (treat as INFERENCE); CHECK = confirm before building. Vendor pages are marketing. Our status is read from docs/features/DIAL.md and the 5 Nov SPEED entry in docs/DECISIONS.md.

## 1. Who does what (short cards)

**Dialers and sales engagement**
- **PhoneBurner** (VERIFIED): $140 / $165 / $183 per user per month (annual). Unlimited power dialing, 1-click voicemail drop, custom dispositions on all tiers; live monitoring and coaching from Professional; AI note taker only on Premium. Has a HighLevel marketplace connector built by a third party, about 80 contacts/hour claimed. Local presence and call recording KNOWN.
- **Kixie** (VERIFIED): no public price. Tiers: Professional (no dialer), Single-line PowerDialer, Multi-line PowerDialer (up to 4 lines). Voicemail drop and live coaching on all tiers; AI human-voice detection (skips IVR/voicemail); conversation intelligence is an add-on. Its GHL speed-to-lead page says GHL form, tag or stage triggers feed the dialer with retries and outcomes write back to the pipeline (vendor claim). One roundup says it needs Zapier for GHL (conflict, CHECK).
- **Aloware** (VERIFIED): $40 / $70 / $100 per user per month (10 / 5 / 5 seat minimums). Power dialer only from the $70 tier. Voicemail drop on all; local presence is a paid add-on (about $300/month); cascade, round-robin and SimulRing routing, IVR, lead API and webhooks on all tiers; AI voice analytics minutes tiered. No leaderboard on the pricing page.
- **Close** (VERIFIED): Solo $9, Essentials $35, Growth $99, Scale $139 per user. Power dialer and voicemail drop from Growth; predictive dialer and listen/whisper/barge coaching on Scale. Round-robin and automatic lead and task assignment. Leaderboard and workflow performance from Growth. AI assistant (lead summaries, suggested actions, batch AI calling). Calls about $0.02/min. Best benchmark for "dialer inside a small-team CRM".
- **Hot Prospector** (vendor claims): GHL-native power dialer, positioned against GHL's own single-line queue (60 to 80 dials a day). KNOWN: AI voice, missed-call text-back, GHL-only.
- **Orum, Dialpad, JustCall, Salesloft, Outreach** (KNOWN): Orum is parallel dialing with AI voice detection for outbound SDR teams (enterprise price). Dialpad and JustCall add AI call summaries, live coaching cues, sentiment, scorecards and local presence at roughly $15 to $60 per user. Salesloft and Outreach are cadence engines (call, email, task steps), conversation intelligence and forecasting, $100+ per user, annual contracts. Not our buyer.
- **HubSpot, Salesforce, Pipedrive, Nutshell** (KNOWN): HubSpot has lead rotation, calling in the CRM, sequences, task queues, recording and AI call summary on paid seats. Salesforce Sales Engagement has work queues, cadences, Einstein lead scoring and conversation insights. Pipedrive has a basic call log plus add-ons. Nutshell has a power dialer, call logging and round-robin on higher tiers. All are full CRMs; none is an overlay for another CRM.

**Speed-to-lead and lead response**
- **Chili Piper** (VERIFIED): from $15,000/year (15 seats) or $42,000/year; ChiliCal $12/user. Books a meeting from a web form before the buyer leaves, round-robin with weights, caps and no-show adjustment, SLAs, funnel analytics. Priced for B2B SaaS, not for local-service agencies.
- **Hatch, Podium, Weave** (KNOWN): Hatch does automated text/AI follow-up cadences and reactivation for home services and GHL; Podium and Weave do webchat, missed-call text-back, review requests and payments for local SMBs ($250 to $600+ per location per month). They answer the lead; they do not measure the team.
- **Smith.ai, Grasshopper** (KNOWN): human or AI receptionists and a virtual number; answer and capture, no pipeline analytics.
- **LeadSimple, Calendly routing, Zapier-style routing, Convert/Convrt, Drift, Intercom** (KNOWN): LeadSimple is real-estate lead routing and follow-up; Calendly routing forms send leads to a rep's calendar; Zapier/Make do ad-hoc round-robin; Drift and Intercom have chat routing with office hours and response-time rules. All act on one source; none is a cross-client audit of how fast people really reply.
- **Marketplace position** (VERIFIED via roundup): the GHL marketplace dialers are PhoneBurner, Kixie, Aloware, Hot Prospector and several "power dialer for GHL" listings. They sell calling. Nobody found sells "proof of how fast every client account answers, across the agency".

## 2. Feature matrix

Our status: DONE = in Speed v4 / Call mode on main; PART = partly; NO. API column: yes / no / needs scope / needs telephony (the CRM API cannot place calls, per MOAT.md).

| Feature | Who has it | Do we have it | Buildable via CRM API + our data | Money story | Effort |
|---|---|---|---|---|---|
| Waiting-leads queue ranked by money/decay | Chili Piper (partly), Close tasks, HubSpot queues | DONE | yes | Core: a reply-now list agencies sell as a service | done |
| Per-account reply target (SLA) | Chili Piper, Intercom | DONE | yes | Yes: makes the promise measurable per client | done |
| Breach alert to a person (email, in-app) | Chili Piper, Hatch, HubSpot | PART (alerts still judge the default target, UNSURE) | yes, our alert engine | Highest: "you were about to lose this lead" | S |
| Alert by Slack / SMS push | Podium, Kixie, Zapier | NO | Slack yes; SMS needs telephony | High; setters do not read email | M |
| Round-robin / owner assignment of new leads | Close, Aloware, Chili Piper, HubSpot | NO ("who should reply" is a display) | write assignedTo, needs write scope | Yes, agencies pay for routing | M |
| Auto-reassign on breach (escalation ladder) | Chili Piper, Salesforce | NO | write assignedTo + alert manager; needs write scope | Yes, closes the SLA loop | M |
| Missed-call callback list | Close, Dialpad, Podium text-back | DONE (touch_events) | yes | Yes: fastest money recovery | done |
| Auto text-back on missed call/form | Podium, Hatch, Hot Prospector, Weave | NO | the CRM's own workflows do this; we would duplicate | Crowded; recommend the workflow instead | L |
| Call-mode list, auto-advance, hotkeys | PhoneBurner, Close, Kixie | DONE | yes | Yes | done |
| Dispositions (outcomes) | all dialers | DONE (7 outcomes) | yes | Table stakes | done |
| Custom dispositions per account | PhoneBurner, Close | NO | our table only | Low-medium | S |
| Call script with merge fields | PhoneBurner, Close, Salesloft | DONE | yes | Low alone | done |
| Call note + follow-up task to CRM | all | DONE (gated gateway) | write scopes (notes, tasks) | Yes | done |
| Real power/parallel dialing | PhoneBurner, Kixie, Orum, Aloware | NO | needs telephony | Big, but a different company; avoid | L (avoid) |
| Voicemail drop | PhoneBurner, Kixie, Close, Aloware | NO | needs telephony | Medium | avoid |
| Local presence | PhoneBurner, Aloware add-on, Dialpad | NO | needs telephony | Medium | avoid |
| AI call summary + auto note | Dialpad, JustCall, Close, PhoneBurner Premium | NO | needs recordings/transcripts; CHECK scope | High if transcripts reachable | M |
| Live coaching (listen/whisper) | PhoneBurner, Kixie, Close Scale | NO | needs telephony | Medium | avoid |
| Post-call coaching: calls scored and flagged | Dialpad, Gong, Salesloft | NO | transcript dependent, CHECK | High for agency owners | L |
| Leaderboard / goals (calls, reached, booked) | Close, Kixie, HubSpot | PART (manager stats, calls an hour) | yes, our outcomes + touch_events | Medium; motivates setters | S |
| Daily goal and streak per setter | Close, Salesloft | NO | our data | Low-medium | S |
| Reply time by source/campaign | Chili Piper funnel, HubSpot | DONE (speed by source) | yes | Yes for ad agencies | done |
| 24-hour coverage strip / after-hours gap | Smith.ai positioning, Intercom hours | DONE | yes | Yes: sells an answering-service upsell | done |
| Business-hours-aware SLA clock | Intercom, Chili Piper | PART (clock_start; CHECK hours per account) | yes | Medium: avoids false breaches | S |
| Cross-client agency ranking | none found | DONE (Who is slow, agency view) | yes | Our wedge | done |
| Booking rate by first-reply time | Chili Piper, HubSpot reports | NO | yes: touch_events + appointments | Very high: proves why speed matters | M |
| Speed proof report (white-label link/PDF) | none (AgencyAnalytics is generic) | PART (audit is shareable) | yes | Very high: agencies send to clients | M |
| Instant booking from form | Chili Piper, Calendly | NO | CRM calendar is native; skip | Crowded | avoid |
| DND / quiet-hours guard | Close, PhoneBurner (DNC scrub) | DONE (DND skip, 8 to 21 warning) | yes | Compliance trust | done |
| Cadence / multi-step follow-up (call day 1, 2, 4) | Salesloft, Outreach, Close | PART (hot lead 3 days) | yes as lists; sending stays in the CRM | Medium | M |
| Pre-call context card | Salesloft, Close, HubSpot | DONE | yes | Yes | done |
| Dial-session analytics (contact rate by hour/day) | Kixie, PhoneBurner, Orum | NO | yes: our outcomes + time | Medium: "call at 10am" | S |
| Mobile one-tap view for setters | PhoneBurner app, Close app | CHECK (iframe) | yes | Medium | M |

## 3. TOP 12 to add, ranked by money

1. **Booking rate by first-reply time**: "leads answered in 5 min book 3x more" from the account's own data. The sales argument for every other feature. M.
2. **Breach alerts that respect each account's target and hours**, to the right person, with Slack/email push and a one-tap "reply now" link. Fix the UNSURE gap first. S.
3. **Escalation ladder**: breach, then ping owner, then manager, then reassign (write scope optional). M.
4. **Round-robin owner assignment for new leads** (optional write scope, per account, off by default). M.
5. **White-label speed proof report** (per client, per month, hosted link and PDF): median reply, share in target, after-hours gap, bookings. M.
6. **Business-hours-aware SLA clock and after-hours coverage report**: removes false breaches, surfaces the answering-service upsell. S.
7. **Setter leaderboard and daily goals** (calls, reached, booked, speed), agency view across clients. S.
8. **Missed-call and form-lead callback queue with a countdown**, ordered by money (extend what exists; suggest text-back, do not send). S.
9. **AI call summary and note draft** where the CRM exposes transcripts; otherwise an AI note from the outcome plus context. M (CHECK scope).
10. **Dial-session analytics**: best hours and days to reach each account's leads, from our own outcomes. S.
11. **Custom dispositions with next steps** (booked sets a tag, wrong number sets DND), per account. S to M.
12. **Cadence lists**: day 1/2/4/7 call schedules as ranked lists with "touch N of M". M.

## 4. Five ideas beyond all of them (our moat)

1. **Speed benchmark across the network**: anonymised median reply time by industry and lead source from every installed account. "You are slower than 78% of med spas." Nobody else holds this panel. Needs consent and a minimum group size.
2. **Money-at-risk meter per client**: speed history times that account's own booking rate and deal value, shown to the agency as dollars lost last month and recoverable this month. Competitors count calls; we price the delay.
3. **Agency-wide "who covers who"**: when one client's setter is idle or slow, show spare capacity elsewhere in the agency and offer one-tap reassign across accounts. Only a multi-client view can do it.
4. **Proof-of-service reports as a retention tool**: a monthly white-label "we replied in 4 min, 96% in target" page agencies attach to invoices. Our event store gives a history the CRM does not keep, so it is hard to fake and hard to copy.
5. **Counterfactual replay**: take last quarter's leads and show what the numbers would have been under a stricter target or with after-hours cover, using their own history. Sells the next plan tier and the cover upsell with the customer's own evidence.

## 5. Notes and risks
- No competitor was found that measures reply speed per client account across an agency, with history, inside the CRM. CHECK this again before using it in marketing.
- Calling stays an own-phone flow. Anything needing telephony (voicemail drop, local presence, parallel dial, live coaching) is a partnership with Kixie or PhoneBurner, not a build; importing their call logs is the cheaper path.
- Write features (assignment, notes, tasks, tags) need optional write scopes and the existing gateway (preview, confirm, audit).
- Prices are public list prices read on 6 Nov 2026; enterprise vendors hide pricing.

Sources: phoneburner.com/pricing, aloware.com/pricing, kixie.com/pricing, close.com/pricing, chilipiper.com/pricing, kixie.com/integrations/go-high-level/speed-to-lead, hotprospector.com (compare, blog), aloware.com/blog/gohighlevel-power-dialer, G2 and TrustRadius comparison pages.
