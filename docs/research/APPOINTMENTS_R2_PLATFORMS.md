# Appointments R2: other booking platforms (researched 2026-11-10)

Labels: VERIFIED = read on the vendor page this session; INFERENCE = my reasoning; UNVERIFIED = memory or could not load. Marketing pages only; vendor claims, not tested.

## Platform notes

**Calendly** (https://calendly.com/pricing) VERIFIED: Free $0; Standard $10/seat; Teams $16/seat; Enterprise from $15k/yr. Round robin and lead routing are Teams+. Payments via Stripe/PayPal from Standard. Reminders and cancellation policy from Standard. Team analytics listed (tier ambiguous). Reviews VERIFIED (https://www.capterra.com/p/148036/Calendly/reviews/): 4.7 on Capterra (4,097) and G2 (2,472). Complaints: analytics shallow, features gated by tier, export fails on large data, hard to reach support. Praise: ease of use.

**Acuity** (https://acuityscheduling.com/pricing) VERIFIED: Starter $16, Standard $27, Premium $55 per month (annual). Deposits on all plans; packages and waitlist from Standard; SMS reminders from Standard. No reports or no-show fees on the page.

**Cal.com** (https://cal.com/pricing) VERIFIED: Free; Teams $12/user; Organizations $28/user. Round robin, routing forms and booking analytics from Teams; variable routing at Organizations. Free includes Stripe/PayPal payments.

**SavvyCal** (https://savvycal.com/pricing) VERIFIED: $10 or $17/user (annual). Round robin on both; every host needs a paid seat. No analytics or no-show features on the page.

**Chili Piper** (https://www.chilipiper.com/pricing) VERIFIED: Growth from $15,000/yr (15 seats), Scale from $42,000/yr; all annual. Routing, round robin, meeting and funnel analytics, SLA settings, "where leads drop off between form and meeting". Per-tier detail not clear. Reviews: UNVERIFIED (not fetched).

**Setmore** (https://www.setmore.com/pricing) VERIFIED: Free up to 4 users, including analytics and reports; Pro about $5/user (page also shows conflicting figures). Deposits and SMS reminders on Pro only.

**Square Appointments** (https://squareup.com/us/en/appointments/pricing) VERIFIED: tiers Starter (free), Plus, Premium; prices not captured. No-show fees, cancellation policy and waitlist on Plus; "future bookings report" on Premium.

**Mindbody** (https://www.mindbodyonline.com/business/pricing) VERIFIED: from $79/month, priced per location not per staff. Automatic late-cancel and no-show fees via Mindbody Payments. Analytics deeper at Accelerate and Ultimate (client, growth, retention). Marketplace fee 20% of a new client's first purchase, capped at $30.

**Vagaro** (https://www.vagaro.com/pro/pricing) VERIFIED: $23.99/month for 6 months then $30 (single location), plus $10 per bookable calendar up to 7. Advanced reports, waitlist, unlimited reminders on every plan.

**Fresha** (https://www.fresha.com/pricing) VERIFIED: subscription per bookable member (priced in NGN for this region). Basic reporting; richer "Insights" is a paid add-on. Deposits and no-show protection tie to its payments.

**Jane App** (https://jane.app/pricing) VERIFIED: CAD $59 / $79 / $99 per month. Appointment, client and billing reports, exports, waitlist, SMS reminders, packages at Thrive.

**Smith.ai** (https://smith.ai/pricing) VERIFIED: $300 / $810 / $2,100 per month by call quota; booking is $1.50/call on top. A human receptionist, not a dashboard.

**Databox** (https://databox.com/pricing) VERIFIED: Agency $79/month plus $20 per account pack (annual); white-label add-on $80. Alerts are barely described.

**AgencyAnalytics** (https://agencyanalytics.com/pricing) VERIFIED: $20 per client per month (annual). No calendar or booking connector named on the page.

**Boulevard, Zenoti, Podium, Birdeye, Hatch**: UNVERIFIED. Boulevard page returned nothing; Hatch page 404; Zenoti, Podium and Birdeye not fetched. INFERENCE from general knowledge: Boulevard and Zenoti are enterprise salon suites with quote-based pricing and deep service and staff reports; Podium and Birdeye sell messaging and review tools with scheduling as an add-on; Hatch automates lead follow-up and reactivation. Re-check before relying on any of this.

## What the market does and does not show

- Booking features (reminders, deposits, waitlist, round robin) are commodities, usually gated by tier. VERIFIED across the pages above.
- Reporting is the weak point. The pages I read do not mention cross-account comparison, an event history of status changes, or true show rate based on outcomes. Calendly reviewers call analytics shallow. INFERENCE: the gap is real, but my sample was marketing pages only and absence on a page is not proof of absence in the product.
- Per-user booking share and leaderboards: Chili Piper and Calendly teams sell round robin and routing analytics, but no page I read shows a setter leaderboard. UNVERIFIED.
- Price anchors: per seat $5 to $28; per client $20 (AgencyAnalytics); Databox $20 per account pack. Our $11.50 per client account sits below agency-reporting tools. INFERENCE.
- Hard to copy: our own history of appointment status changes, and one view across many client accounts. Vertical suites (Mindbody, Vagaro) are hard to copy because they own payments and the calendar. Chili Piper owns CRM routing. INFERENCE.

## Comparison (us vs top 6)

| | SubSync | Calendly | Acuity | Cal.com | Chili Piper | Mindbody | AgencyAnalytics |
|---|---|---|---|---|---|---|---|
| Price | $11.50/client acct | $10-16/seat | $16-55 | $12-28/user | $15k+/yr | from $79/loc | $20/client |
| Books appointments | No (reads) | Yes | Yes | Yes | Yes | Yes | No |
| Cross-account view | Yes (planned) | No | No | Org tier only | No | Multi-location | Yes (reports) |
| Show/no-show outcome | Planned | Reminders only | Not listed | Not listed | Not listed | Fees | Not listed |
| Alerts | Core | No | No | No | SLA | Fees | Not listed |
| Per-user share | Planned | Team analytics | Not listed | Booking analytics | Yes | Not listed | No |

SubSync column is our plan, not shipped. Competitor cells are only what their pages state; "Not listed" is not "absent".

## Features worth building, ranked

1. **Unmarked-past-appointments alert**: staff forget statuses, so every show-rate number is wrong until fixed; no competitor page mentions it.
2. **True show rate by account, setter and source**: the number agencies must prove to clients; reviewers say others' analytics are shallow.
3. **No-show recovery list (last 7 days, not rebooked)**: revenue back with one click to the contact; Hatch-style value without sending messages.
4. **Cross-account booking health ranking**: agency owner sees the worst account first; Chili Piper's price shows buyers pay for routing and funnel insight.
5. **Booking share per user and leaderboard**: setters and owners see who books; plain-language, no setup.
6. **Lead-to-booking drop-off (speed to lead to booked)**: Chili Piper sells "where leads drop off"; we can do it across tools, read-only.
7. **Lead time and cancellation trend from our event store**: history others lack; proves improvement in weekly Receipts.
8. **Revenue per appointment / at-risk dollars**: ties to Instant Audit, only when deal values are trustworthy.
