# SubSync - Complete Feature Encyclopedia
## Every feature across both app modes: Agency + Sub-Account

Add to Claude Code project as `docs/FEATURE_ENCYCLOPEDIA.md`. This replaces and expands the previous two feature docs.

---

## TWO APP MODES

**Agency Mode** - installed by agency owner, sees ALL sub-accounts, cross-account intelligence.
**Business Mode** - installed by a single business inside their own sub-account. No cross-account features. Focuses on making THEIR business smarter.

Every feature below is tagged: [AGENCY], [BUSINESS], or [BOTH].
Features tagged [BOTH] work in either mode - in Agency Mode they aggregate across sub-accounts; in Business Mode they work for the single account.

---

## 1. APPOINTMENT & BOOKING INTELLIGENCE (28 features)

**1.1 Show Rate Dashboard** [BOTH]
- Overall show rate as a big number with trend arrow (up/down vs last period)
- Show rate broken down by: calendar, assigned user, day of week, time of day, lead source, booking channel
- In Agency Mode: show rate per sub-account with ranking
- Configurable date range: today, this week, this month, last 30/60/90 days, custom

**1.2 No-Show Tracker** [BOTH]
- List of all no-shows with: contact name, phone, email, appointment time, assigned user, how many times this contact has no-showed before
- One-click deep link to open contact in GHL
- Filter by date range, assigned user, calendar
- "Repeat offenders" section: contacts who have no-showed 2+ times
- In Agency Mode: no-shows across all sub-accounts

**1.3 No-Show Recovery Monitor** [BOTH]
- After a no-show, did the contact rebook? When? Did they show the second time?
- Recovery rate: what % of no-shows eventually rebook?
- Recovery time: average days from no-show to rebook
- Which recovery method works best: SMS, email, call, or automated workflow?
- In Agency Mode: compare recovery rates across sub-accounts

**1.4 Appointment Source Attribution** [BOTH]
- Which funnel, form, ad, or referral source generated each appointment?
- Show rate BY source: "Facebook Ads leads show at 58%, Google Ads at 72%, referrals at 89%"
- Appointments per source per period with trends

**1.5 Booking Velocity** [BOTH]
- Average time from lead created to first appointment booked
- Trend over time: is booking getting faster or slower?
- Per user: which setter books appointments fastest?
- Per source: which lead sources book fastest?

**1.6 Calendar Utilization Rate** [BOTH]
- What % of available appointment slots were filled this week/month?
- Per calendar, per user
- Identifies: overbooked staff, underbooked staff, peak demand hours
- Suggests optimal working hours based on booking patterns

**1.7 Best Booking Times Analysis** [BOTH]
- Heatmap: which hours of which days get the most bookings?
- Heatmap: which hours of which days have the highest show rate?
- "Your leads are 3x more likely to show for 10am Tuesday appointments than 4pm Friday"
- Recommendation: adjust calendar availability based on data

**1.8 Appointment Prep Brief** [BUSINESS]
- Before any upcoming appointment, auto-generate a one-paragraph brief:
- "You're meeting Sarah Johnson at 2pm. She's a warm lead from Facebook Ads. She submitted a form 3 days ago about kitchen renovation. Your team responded in 7 minutes. She was tagged 'high-value' by your setter. Pipeline value: $45,000. This is her first appointment."
- Uses contact data + opportunity data + conversation history from cache

**1.9 Confirmation Rate Tracker** [BOTH]
- Of bookings made, what % confirmed (replied to confirmation SMS/email)?
- Confirmation rate by channel (SMS vs email)
- Unconfirmed appointments flagged with countdown to appointment time
- "14 appointments tomorrow, 9 confirmed, 5 unconfirmed - suggest sending reminder now"

**1.10 Rescheduling Patterns** [BOTH]
- How often do contacts reschedule?
- Average number of reschedules before showing
- Contacts who reschedule 3+ times flagged as likely to never show
- Reschedule rate by source, by day, by user

**1.11 Cancellation Analysis** [BOTH]
- Cancellation rate per calendar, per user, per source
- Time-to-cancellation: how far before the appointment do people cancel?
- Late cancellation rate (within 24 hours)
- Cancellation reasons (if captured via custom fields/tags)

**1.12 Appointment Outcome Tracking** [BOTH]
- Beyond show/no-show: what happened AFTER the appointment?
- Did the contact move to a new pipeline stage?
- Did a deal get created or updated?
- Revenue attributed to the appointment
- "This appointment led to a $12,000 deal closed 14 days later"

**1.13 Round Robin Fairness Audit** [BOTH]
- Are appointments being distributed evenly across team members?
- Show the actual distribution vs expected distribution
- Flag: "Mike got 34 appointments this month, Lisa got 18. Distribution is skewed."
- GHL's round robin has known bugs (distributes per day not per appointment) - this audit catches the skew

**1.14 Double-Booking Detection** [BOTH]
- Scan for contacts who have multiple appointments on the same day
- Scan for team members who are double-booked (calendar sync issues)
- Alert before it becomes a problem

**1.15 Wait-Time Analysis** [BOTH]
- How long do contacts wait between requesting info and getting an appointment?
- Wait time by source, by service type, by calendar
- Long wait times = lost leads

**1.16 Cross-Account Calendar View** [AGENCY]
- All appointments from all sub-accounts in one calendar view
- Color-coded by sub-account
- Filter by: user, sub-account, status, calendar type
- The view agency owners NEED but GHL doesn't provide

**1.17 Appointment Volume Forecasting** [BOTH]
- Based on historical patterns, predict next week's/month's appointment volume
- Factor in seasonality, trends, day-of-week patterns
- "Based on your last 90 days, expect 42-48 appointments next week"

**1.18 Setter Efficiency Score** [BOTH]
- Composite score per setter: calls-to-booking ratio, response time, show rate of their bookings, average booking velocity
- Ranked against team average
- Trend: improving or declining?

**1.19 Peak Demand Forecasting** [BOTH]
- Predict which days/hours will have the most appointment requests
- Suggest adding availability during peak times
- Suggest reducing availability during dead times

**1.20 Appointment Revenue Value** [BOTH]
- Estimated revenue value per appointment based on historical close rates
- "Each showed appointment is worth approximately $X based on your data"
- Total appointment revenue pipeline

**1.21 Time-to-Appointment by Lead Temperature** [BOTH]
- How fast do hot leads get appointments vs cold leads?
- Are hot leads being prioritized?

**1.22 Post-Appointment Follow-Up Tracking** [BOTH]
- After an appointment, was a follow-up sent? How quickly?
- Follow-up rate per user
- Gap detection: "12 appointments last week had no follow-up within 48 hours"

**1.23 Appointment Density Map** [AGENCY]
- Geographic visualization of where appointments are happening (if address data exists)
- Useful for agencies managing local service businesses

**1.24 Calendar Health Score** [BOTH]
- Composite score: utilization rate, show rate, confirmation rate, distribution fairness
- One number that tells you if your booking system is healthy

**1.25 Meeting Duration Tracking** [BOTH]
- Actual vs scheduled duration (if trackable through calendar end times)
- Which setters/closers run over time?
- Average duration by appointment type

**1.26 Rebooking Rate** [BOTH]
- Of contacts who had one appointment, what % book a second?
- Rebooking rate by user (which closer gets repeat meetings?)
- Indicates relationship quality and sales process health

**1.27 Same-Day Booking Performance** [BOTH]
- Show rate for same-day bookings vs future bookings
- Volume of same-day bookings (indicates urgency of leads)

**1.28 Appointment Funnel** [BOTH]
- Visual funnel: Leads → Booked → Confirmed → Showed → Converted
- Drop-off rate at each step
- Where is the biggest leak in the appointment pipeline?

---

## 2. PIPELINE & DEAL INTELLIGENCE (22 features)

**2.1 Pipeline Conversion Funnel** [BOTH]
- Per pipeline: deals entering each stage, advancing, dropping
- Conversion rate between every stage pair
- In Agency Mode: compare conversion rates across sub-accounts

**2.2 Deal Velocity** [BOTH]
- Average days from opportunity created to won
- By pipeline, by source, by assigned user, by deal value range
- Velocity trend: speeding up or slowing down?

**2.3 Stage Dwell Time** [BOTH]
- Average time deals spend in each stage
- Identify bottleneck stages
- Deals exceeding 2x average dwell time flagged

**2.4 Revenue Forecasting** [BOTH]
- Weighted pipeline: deal value x probability per stage
- 30/60/90 day projections
- In Agency Mode: total portfolio forecast across all sub-accounts
- Confidence bands: best case, likely, worst case

**2.5 Win/Loss Analysis** [BOTH]
- Win rate by period, by source, by user, by deal size
- Stage of loss: where do deals die most?
- Lost deal value: how much revenue leaked?
- Win rate trend over time

**2.6 Deal Risk Scoring (AI)** [BOTH]
- 1-100 risk score per open deal based on: days in stage, activity recency, contact engagement
- Color coded on all deal views
- Sorted by risk: most at-risk deals at the top

**2.7 Source Attribution for Deals** [BOTH]
- Which lead sources produce the most WON deals, not just leads
- Revenue per source
- Full-funnel conversion: leads from source → appointments → deals → won → revenue
- ROI per source (if cost data is available)

**2.8 Deal Value Distribution** [BOTH]
- Histogram of deal values: how many $1K deals, $5K deals, $10K+ deals
- Average and median deal value
- Trend: is average deal size growing or shrinking?
- Largest deals in pipeline

**2.9 Pipeline Value Trend** [BOTH]
- Total pipeline value over time (daily/weekly/monthly)
- Net new pipeline added vs pipeline lost per period
- Pipeline growth rate

**2.10 Close Rate by User** [BOTH]
- Which team member closes the most deals?
- Close rate percentage per user
- Revenue per user per period
- In Agency Mode: cross-sub-account closer leaderboard

**2.11 Pipeline Aging Report** [BOTH]
- Deals aged 0-30 days, 31-60, 61-90, 90+ days
- Total value in each aging bucket
- Alert: "42% of your pipeline value is in deals older than 60 days"

**2.12 Deal Movement Log** [BOTH]
- Timeline of every stage change for every deal
- "Deal X moved from 'Proposal Sent' to 'Negotiation' on Oct 15 by User Y"
- GHL's native audit log only keeps 60 days. SubSync stores permanently.

**2.13 Revenue by Product/Service** [BOTH]
- If custom fields track product/service type, break down revenue by category
- Identify best-selling products/services

**2.14 Monthly Recurring Revenue Tracker** [BOTH]
- For subscription-based businesses: MRR, churn rate, net new MRR
- Growth trend
- Churned customers list with last activity date

**2.15 Deal Comparison (Agency)** [AGENCY]
- Compare pipeline health metrics side by side across sub-accounts
- Which client has the healthiest pipeline?
- Which client's pipeline is in trouble?

**2.16 Abandoned Deal Recovery** [BOTH]
- Deals marked as lost or abandoned in the last 30/60/90 days
- Suggest: "These 8 deals worth $47,000 were abandoned. Reconnect?"
- One-click to reopen and assign

**2.17 Seasonal Pipeline Patterns** [BOTH]
- After 6+ months of data: which months have the strongest pipeline?
- Plan ahead for slow seasons

**2.18 Average Touches to Close** [BOTH]
- How many calls, emails, SMS does it take to close a deal?
- By deal size, by source, by user
- Efficiency metric: fewer touches with same close rate = better process

**2.19 Proposal-to-Close Rate** [BOTH]
- Of deals that reach the proposal/quote stage, what % close?
- Time from proposal to decision
- Identifies if the problem is proposals or earlier qualification

**2.20 Pipeline Coverage Ratio** [BOTH]
- Pipeline value vs target revenue
- Rule of thumb: 3x pipeline coverage needed for healthy forecast
- "You need $150K in pipeline to hit your $50K monthly target. Current pipeline: $98K. Gap: $52K."

**2.21 Dead Pipeline Cleanup** [BOTH]
- Identify deals with: no activity for 90+ days, no assigned user, $0 value, no contact linked
- Bulk flag for review or cleanup
- Keeps pipeline data accurate

**2.22 Multi-Pipeline Summary** [BOTH]
- Many GHL sub-accounts have multiple pipelines (sales, onboarding, upsell, etc.)
- One view showing all pipelines: value, deal count, conversion rate, velocity
- In Agency Mode: all pipelines across all sub-accounts

---

## 3. CONTACT & LEAD INTELLIGENCE (20 features)

**3.1 Cross-Account Contact Search** [AGENCY] - ALREADY BUILT
**3.2 Data Completeness Report** [BOTH] - ALREADY BUILT
**3.3 Duplicate Finder** [BOTH] - ALREADY BUILT

**3.4 Lead Quality Scoring** [BOTH]
- Score contacts 1-100 based on: source, engagement level, form data completeness, response to outreach, appointments booked
- Configurable scoring weights per sub-account
- Sort contact lists by quality score: work the best leads first

**3.5 Contact Lifecycle Tracker** [BOTH]
- Visual journey: Lead → Qualified → Appointment Set → Showed → Customer → Repeat
- Where is each contact in the lifecycle?
- Lifecycle stage distribution: "You have 340 leads, 89 qualified, 34 appointment set, 12 customers"
- Movement between stages over time

**3.6 Lead Aging Report** [BOTH]
- How long have leads been sitting without conversion?
- Leads older than 30/60/90 days without appointment
- "You have 147 leads older than 60 days that never got an appointment. These are going cold."

**3.7 Lead Source Performance** [BOTH]
- Not just volume: quality of leads by source
- Source → appointment rate, show rate, close rate, revenue
- Best performing sources vs worst
- Cost per quality lead if cost data is available

**3.8 Contact Activity Timeline** [BOTH]
- For any single contact: visual timeline of every interaction
- When they came in, every message sent/received, every call, every appointment, every pipeline change, every tag change
- Single view of the complete relationship history
- GHL has this per-contact but SubSync can show it FASTER from cached data

**3.9 Inactive Contact Identification** [BOTH]
- Contacts with no activity in 30/60/90/180 days
- Segmented by: never engaged, engaged then went silent, customer who stopped buying
- Total count and percentage of database
- Suggestion: reactivation campaign or archive

**3.10 Contact Growth Metrics** [BOTH]
- New contacts per day/week/month with trends
- Net growth: new contacts minus unsubscribes/deletions
- In Agency Mode: growth rate per sub-account
- Growth rate comparison: accelerating or decelerating?

**3.11 Tag Usage Analytics** [BOTH]
- Most used tags, least used tags, tags applied but never used in automations
- Tag health: inconsistencies, duplicates, misspellings
- In Agency Mode: tag standardization across sub-accounts

**3.12 Custom Field Completion Report** [BOTH]
- For each custom field: what % of contacts have it filled?
- Identify fields that are critical but rarely completed
- "Only 23% of contacts have 'budget' filled in. This hurts qualification."

**3.13 Contact Engagement Heatmap** [BOTH]
- When do contacts engage most? (open emails, reply to SMS, answer calls)
- Heatmap by hour and day of week
- "Your contacts are most responsive at 10am-12pm Tuesday through Thursday"
- Suggests best times to send campaigns or make calls

**3.14 Unsubscribe/DND Tracking** [BOTH]
- How many contacts opted out this period?
- Unsubscribe rate trend
- Which campaigns or messages triggered the most unsubscribes?
- DND contacts as % of total database

**3.15 Contact Enrichment Gaps** [BOTH]
- Beyond completeness: which contacts have WRONG data?
- Invalid email detection (syntax check, known disposable domains)
- Invalid phone detection (wrong length, wrong country code)
- "87 contacts have email addresses that will bounce"

**3.16 Referral Tracking** [BOTH]
- If referral source is tagged: which customers refer the most?
- Referral conversion rate
- Revenue from referrals
- Top referrers list

**3.17 Birthday/Anniversary Manager** [BUSINESS]
- Upcoming birthdays and anniversaries from contact custom fields
- Automated reminder list
- "12 contacts have birthdays in the next 7 days - send a message?"

**3.18 VIP Contact Flagging** [BOTH]
- Auto-flag contacts based on: deal value, number of purchases, engagement level
- VIP dashboard: your most valuable contacts and their current status
- Alert if a VIP hasn't been contacted in X days

**3.19 Contact Import History** [BOTH]
- Track when bulk imports happened and how many contacts were added
- Identify data quality issues from bad imports
- Import source tracking

**3.20 Cross-Sub-Account Contact Overlap** [AGENCY]
- Same person exists in multiple sub-accounts
- Useful for: franchise clients, agencies where clients share a geographic market
- Conflict detection: "This lead is being worked by two of your clients"

---

## 4. COMMUNICATION & INBOX INTELLIGENCE (18 features)

**4.1 Unified Inbox** [AGENCY]
- All unread conversations from all sub-accounts in one feed
- Filter by: sub-account, channel type (SMS, email, FB, IG, WhatsApp, live chat, GMB), assigned user
- Priority flagging
- Deep link to open in GHL

**4.2 Response Time Dashboard** [BOTH]
- Average first-response time per sub-account, per user, per channel
- Median response time (more useful than average for outliers)
- Response time distribution: % under 5 min, 5-15 min, 15-60 min, 1-4 hrs, 4+ hrs
- SLA tracker: configurable target, red/yellow/green

**4.3 Unresponded Conversation Aging** [BOTH]
- Conversations with no reply, aged by time: 1hr, 4hr, 12hr, 24hr, 48hr+
- Count per aging bucket per sub-account
- Critical alert: conversations over 24hr unresponded

**4.4 Conversation Volume Trends** [BOTH]
- Messages sent/received per day/week/month
- By channel type
- Trend: increasing or decreasing contact engagement?

**4.5 Channel Performance** [BOTH]
- Response rate by channel (SMS vs email vs FB vs IG vs WhatsApp)
- Which channel gets the fastest responses FROM contacts?
- Which channel has the highest engagement?
- "SMS has a 94% open rate, email has 22%. Consider shifting outreach to SMS."

**4.6 Message Template Performance** [BOTH]
- If using saved message templates: which ones get the most responses?
- Response rate per template
- Best performing templates for: initial outreach, follow-up, appointment confirmation, no-show recovery

**4.7 Conversation Sentiment Indicator** [BOTH]
- AI-powered: is this conversation positive, neutral, or negative?
- Flag negative sentiment conversations for manager review
- Sentiment trend per sub-account
- "Client X has 8 negative sentiment conversations this week vs 2 last week"

**4.8 Missed Call Tracking** [BOTH]
- Inbound calls that went to voicemail or were missed
- Response time to missed calls
- Missed call → callback rate
- Revenue impact: missed calls from pipeline contacts

**4.9 Communication Gaps** [BOTH]
- Contacts in active pipeline stages who haven't been contacted in X days
- "34 contacts in your 'Negotiation' stage haven't been contacted in 7+ days"
- Sorted by deal value: biggest deals with gaps first

**4.10 Outbound vs Inbound Ratio** [BOTH]
- Per user: how many outbound contacts vs inbound responses?
- Setters should be heavily outbound; customer service should be heavily inbound
- Helps managers identify if setters are actually making proactive outreach

**4.11 Conversation Duration/Length** [BOTH]
- Average message count per conversation
- Average conversation duration (first message to resolution/booking)
- Identify conversations that go too long without resolution

**4.12 First Contact Resolution Rate** [BOTH]
- For service-type businesses: what % of inquiries are resolved in one conversation?
- Resolution time by channel, by user

**4.13 Communication Cadence Tracker** [BOTH]
- For active pipeline contacts: are they being contacted at the right frequency?
- Gap detector: contacts that should be getting weekly touches but haven't been contacted in 3 weeks

**4.14 Auto-Response Effectiveness** [BOTH]
- If workflows send automatic responses: are contacts replying to them?
- Auto-response → human conversation conversion rate
- "Your auto-response converts 34% of leads into conversations vs 12% industry average"

**4.15 Conversation Assignment Balance** [BOTH]
- Are conversations distributed evenly across team members?
- Workload per user: active conversations, unread count, response time
- Overloaded user detection

**4.16 Cross-Account Conversation Search** [AGENCY]
- Search message content across all sub-accounts
- Find any conversation without knowing which account it's in

**4.17 Conversation Outcome Tagging** [BOTH]
- Track what happened at the end of each conversation
- Booked → showed → converted pipeline
- Not interested, wrong number, already a customer, spam

**4.18 Weekend/After-Hours Analysis** [BOTH]
- How many leads come in outside business hours?
- Response time for after-hours leads
- Revenue from after-hours leads
- Justification for AI chatbot or after-hours setter if needed

---

## 5. TEAM & USER PERFORMANCE (16 features)

**5.1 Cross-Account Setter Leaderboard** [AGENCY]
- Every setter across all sub-accounts ranked by: calls, appointments booked, show rate, close rate
- Configurable time period, sortable columns, exportable

**5.2 Individual User Performance Card** [BOTH]
- Per user: all key metrics on one card
- Calls made, SMS sent, emails sent, appointments booked, show rate, deals won, revenue generated
- Trend vs previous period
- Percentile rank vs team

**5.3 Daily Activity Feed** [BOTH]
- Per user per day: chronological list of everything they did
- Calls, messages, appointments, pipeline changes, notes added
- Manager can review: "What did Sarah do today?"
- In Agency Mode: activity across all sub-accounts

**5.4 Activity Heatmap** [BOTH]
- Grid visualization: users × hours of day
- Color intensity = activity level
- Spot dead zones, late starts, early finishes, lunch breaks that run long

**5.5 Idle Detection** [BOTH]
- Alert when a user has logged no activity for X hours during working hours
- "Setter Mike has been idle for 3 hours. Last activity: 10:14am."
- Configurable thresholds per user role

**5.6 Task Completion Rate** [BOTH]
- GHL has tasks. What % are completed on time?
- Overdue task count per user
- Task aging: how long do tasks sit before being done?

**5.7 User Workload Balance** [AGENCY]
- Across sub-accounts: which users are overloaded, which are underutilized?
- Contact assignment count per user
- Active conversation count per user
- Suggest rebalancing

**5.8 Performance Trends** [BOTH]
- Per user: week-over-week, month-over-month trends
- Improving or declining?
- Auto-flag declining performance for manager attention

**5.9 Ramp-Up Tracker** [BOTH]
- For new hires: track their daily/weekly metrics over their first 30/60/90 days
- Compare ramp curve to established team members
- "New setter Alex is at 65% of team average after 3 weeks. On track."

**5.10 Coaching Queue** [BOTH]
- AI-generated list of team members who need coaching, ranked by urgency
- Based on: declining metrics, high error rates, low conversion, slow response times
- Each entry includes: specific metrics that triggered the flag, suggested coaching focus

**5.11 Time-to-First-Action** [BOTH]
- When a user logs in, how quickly do they start working?
- Average time from login to first call/message/action
- Identifies slow starters

**5.12 User Comparison Tool** [BOTH]
- Side-by-side comparison of two users across all metrics
- Useful for: performance reviews, identifying what top performers do differently

**5.13 Shift Coverage Map** [BOTH]
- For teams working shifts: visual map of who's covering which hours
- Gap detection: hours with no coverage
- Overlap detection: hours with too many people

**5.14 User Permission Audit** [AGENCY]
- Which users have access to which sub-accounts?
- Over-permissioned users flagged
- Users with access to accounts they shouldn't see

**5.15 Achievement System** [BOTH]
- Gamification: badges for milestones
- "Speed Demon" - fastest response time 5 days in a row
- "Iron Dialer" - 50+ calls in a day
- "Perfect Week" - 100% show rate for a week
- "Revenue King" - most revenue generated this month
- Visible on user's performance card and leaderboard
- Optional: Slack/email notification when someone earns a badge

**5.16 Team Standup Generator** [BOTH]
- AI-generated daily standup summary per team:
- Yesterday's highlights, today's priorities, blockers
- Based on actual activity data, not self-reported

---

## 6. CLIENT SUCCESS & CHURN PREVENTION (14 features)

**6.1 Client Engagement Score** [AGENCY]
- 1-100 composite score per sub-account
- Based on: lead volume trend, appointment activity, pipeline movement, conversation responsiveness, workflow activity
- Dashboard with all clients scored, red/yellow/green

**6.2 Churn Risk Predictor** [AGENCY]
- Flag clients showing churn signals:
  - Lead volume declining 3+ weeks
  - Fewer logins (if trackable)
  - Response times increasing
  - Pipeline stagnating
  - Support tickets increasing
  - No new campaigns/workflows in 30+ days
- "Client X churn risk: HIGH. Lead volume down 45%, no new workflows in 6 weeks."

**6.3 Weekly Agency Digest Email** [AGENCY]
- Every Monday morning: email to agency owner
- Per sub-account: new contacts, appointments, show rate, deals won, revenue, engagement score change
- Highlights: top improving client, most at-risk client, urgent issues
- The email that makes the agency owner feel in control

**6.4 Weekly Business Summary Email** [BUSINESS]
- Same concept for single business owners
- "This week: 23 new leads, 8 appointments, 75% show rate, 2 deals won worth $6,400"
- Comparison to previous week/month

**6.5 Client ROI Dashboard** [AGENCY]
- Per client: leads generated, appointments booked, deals won, revenue
- Manual input: what the client pays the agency
- Calculated ROI: "Client pays $2,500/month. We generated $18,000 in pipeline value. ROI: 7.2x"
- The slide that saves the client relationship at renewal time

**6.6 Client Health Timeline** [AGENCY]
- Per client: 6-month trend of engagement score
- Annotated with events: "Launched new campaign," "Changed setter," "Paused ads"
- Correlate events to engagement changes

**6.7 Onboarding Progress Tracker** [AGENCY] - ALREADY BUILT, EXPAND IT
- Expand beyond basic checklist to include:
  - Days since install
  - % of features being used
  - First lead received?
  - First appointment booked?
  - First deal won?
  - "Client X is 30 days in and hasn't booked a single appointment. Intervention needed."

**6.8 Quarterly Business Review (QBR) Auto-Generator** [AGENCY]
- One click generates a QBR presentation for a client
- Includes: leads trend, appointment trend, show rate, pipeline value, deals won, revenue, ROI
- Exportable as PDF or shareable link
- Saves 2-4 hours per QBR per client

**6.9 Account Health Comparison** [AGENCY]
- Side-by-side comparison of two or more sub-accounts
- Identify what's different between a high-performing client and a struggling one
- "Client A has 3x the lead volume but 40% lower show rate than Client B. The issue is follow-up speed."

**6.10 Revenue Retention Dashboard** [AGENCY]
- Track agency MRR from clients
- Churned clients list with reasons
- Revenue at risk (clients with declining engagement)
- Net revenue retention rate

**6.11 Client Communication Tracker** [AGENCY]
- When was the last time the agency owner/AM talked to each client?
- Clients not contacted in 14+ days flagged
- "You haven't spoken to Client X in 23 days. Their engagement score dropped 12 points."

**6.12 Client Satisfaction Pulse** [AGENCY]
- Simple periodic survey sent to client contacts: "How satisfied are you with our service? 1-5"
- Tracked over time
- Correlated with churn risk

**6.13 Contract Renewal Calendar** [AGENCY]
- Track client contract end dates
- 30/60/90 day countdown alerts
- Renewal preparation: auto-generate ROI summary for the renewal conversation

**6.14 Client Segmentation** [AGENCY]
- Group clients by: industry, plan tier, engagement level, revenue, lifetime
- Identify patterns: "Your restaurant clients have 85% show rates but your real estate clients have 52%"
- Tailor approach by segment

---

## 7. REPORTING & ANALYTICS ENGINE (12 features)

**7.1 Custom Report Builder** [BOTH]
- Drag-and-drop report creation
- Choose metrics, dimensions, filters, visualization type
- Save reports for reuse
- Share reports via link

**7.2 Scheduled Report Delivery** [BOTH]
- Any saved report can be scheduled: daily, weekly, monthly
- Delivered via email as PDF or interactive link
- Multiple recipients per schedule

**7.3 White-Label Reports** [AGENCY]
- Add agency logo, colors, and name to reports
- Remove SubSync branding
- Reports look like they come from the agency's own system

**7.4 Report Templates Library** [BOTH]
- Pre-built report templates for common use cases:
  - Monthly performance overview
  - Setter performance report
  - Pipeline health report
  - Lead source ROI report
  - Appointment analysis
  - Weekly executive summary
- One click to generate, then customize

**7.5 Data Export Hub** [BOTH]
- Export any data view to: CSV, Excel, PDF, Google Sheets
- Scheduled exports (weekly automatic CSV to email)
- API endpoint for BI tools (Phase 3+)

**7.6 Comparison Views** [BOTH]
- Period comparison: this month vs last month, this quarter vs last quarter
- User comparison: User A vs User B
- In Agency Mode: sub-account comparison

**7.7 Goal Tracking Dashboard** [BOTH]
- Set targets: leads/month, appointments/month, deals won, revenue
- Visual progress bars with projected completion
- On track / at risk / behind status

**7.8 Cohort Analysis** [BOTH]
- Track groups of leads by the month they entered
- What % of January leads converted by March?
- Revenue per cohort
- Identify if lead quality is improving or declining over time

**7.9 Attribution Reporting** [BOTH]
- First-touch attribution: which source originally brought the lead?
- Last-touch attribution: which action preceded the conversion?
- Multi-touch: credit distributed across all touchpoints
- Configurable per report

**7.10 Anomaly Highlighting** [BOTH]
- On every chart and metric: auto-highlight data points that deviate significantly from the trend
- "This week's show rate (48%) is 2 standard deviations below your 90-day average (68%)"
- Red dots on charts where something unusual happened

**7.11 Data Freshness Indicator** [BOTH]
- On every dashboard: "Last synced 4 minutes ago" with a refresh button
- Stale data warning if sync hasn't run in 6+ hours
- Builds trust in the data

**7.12 Executive Summary Widget** [BOTH]
- One card at the top of every dashboard
- 4-6 KPIs with trend arrows and comparison to target
- The only thing a busy owner needs to glance at

---

## 8. SMART CALL LIST & PROSPECTING (10 features)

**8.1 Smart Call Queue Builder** [BOTH]
- Filter contacts across criteria: tags, pipeline stage, last activity, source, assigned user
- Pre-built filters:
  - "Yesterday's no-shows" (one click)
  - "Hot leads not contacted in 3+ days" (one click)
  - "New leads from last 4 hours with no response" (one click)
  - "Proposal stage deals with no activity in 7+ days" (one click)
  - "Customers due for follow-up" (one click)
- In Agency Mode: filter across all sub-accounts
- Deep link to open each contact in GHL

**8.2 Saved Call Lists** [BOTH]
- Save filter combinations as named lists
- "Morning No-Show Recovery"
- "Hot Lead Follow-Up"
- "Stale Pipeline Rescue"
- "Customer Check-In"
- One click to load each morning

**8.3 Call List Priority Scoring** [BOTH]
- AI-scored priority per contact in the list
- Factors: lead temperature, deal value, days since last contact, engagement level
- Work the list top-to-bottom and you're always calling the most important person next

**8.4 Call Outcome Logger** [BOTH]
- After each call from the list: quick disposition buttons
- Answered / Voicemail / No Answer / Wrong Number / Booked / Not Interested / Follow Up
- Logged to SubSync's database for analytics
- Auto-advance to next contact in the list

**8.5 Follow-Up Queue** [BOTH]
- Contacts who need a follow-up in X days auto-appear in a future call list
- "You marked 8 contacts as 'Follow Up in 3 days' last Tuesday. They're due today."
- Never forget a follow-up again

**8.6 Power Hour Tracker** [BOTH]
- Setter starts a "power hour" session
- Timer counts down 60 minutes
- Tracks calls made, contacts reached, appointments booked during the session
- Gamified: beat your personal best

**8.7 Territory/Segment Queues** [AGENCY]
- Divide contacts into territories or segments
- Assign territories to specific setters
- Each setter has their own queue
- Prevents overlap: "This lead belongs to Sarah's territory"

**8.8 Lead Recency Queue** [BOTH]
- Automatically surfaces the newest leads for immediate calling
- Speed-to-lead enforcement: "3 leads came in during the last 15 minutes. Call NOW."
- Ordered by: newest first, highest quality first, or configurable

**8.9 Win-Back List** [BOTH]
- Contacts who were customers but haven't purchased in X months
- Sorted by: last purchase value, lifetime value, days since last contact
- Pre-built for re-engagement campaigns

**8.10 Referral Request List** [BOTH]
- Contacts who are recent happy customers (recent purchase + positive interactions)
- "These 14 customers are ideal for referral requests based on their satisfaction signals"

---

## 9. WORKFLOW & AUTOMATION HEALTH (8 features)

**Note: Workflows API v3 has limited availability. Handle 403 gracefully.**

**9.1 Workflow Inventory** [BOTH]
- List all workflows: name, status (active/draft/inactive), trigger type
- Active count vs total count
- In Agency Mode: inventory across all sub-accounts

**9.2 Inactive Workflow Detection** [BOTH]
- Workflows that are inactive but look like they should be active (have contacts in them, linked to pipelines)
- "This workflow triggered 145 times last month but has been turned off for 3 days"

**9.3 Trigger Conflict Detector** [BOTH]
- Two workflows with the same trigger + same conditions = double-sends, confused pipelines
- Flag potential conflicts

**9.4 Workflow Execution Volume** [BOTH]
- If trackable: how many times each workflow triggered this period
- Most active workflows, least active workflows
- Execution trend

**9.5 Workflow Error Monitor** [BOTH]
- If webhook or workflow errors are detectable: surface them
- "Workflow 'New Lead Follow-Up' has failed 12 times this week"
- Link to the workflow in GHL for debugging

**9.6 Automation Coverage Report** [BOTH]
- What % of contacts are in at least one active workflow?
- Contacts with NO automation running = potential gap
- "234 contacts in your pipeline have no automation. They're getting zero follow-up."

**9.7 Workflow Template Sync** [AGENCY]
- Compare workflows across sub-accounts built from the same snapshot
- Flag: which sub-accounts have modified the template? What changed?
- Ensure consistency across client accounts

**9.8 Workflow ROI Estimation** [BOTH]
- If a workflow sends X messages at $Y cost and produces Z appointments/deals
- Estimated cost per appointment generated by automation
- Which workflows produce the best ROI?

---

## 10. COMPLIANCE & DELIVERABILITY (8 features)

**10.1 DNS Health Checker** [BOTH]
- Per domain: SPF, DKIM, DMARC status
- External DNS lookup (not GHL API)
- Red/yellow/green dashboard
- In Agency Mode: DNS health across all sub-account domains

**10.2 A2P 10DLC Status Tracker** [BOTH]
- Track SMS registration status per sub-account
- Flag accounts sending SMS without proper registration
- Compliance risk score

**10.3 Email Deliverability Monitor** [BOTH]
- Bounce rate, spam complaint rate, unsubscribe rate per sub-account
- Trend over time
- Alert when deliverability degrades
- "Client X's bounce rate jumped from 2% to 11%. Check their list."

**10.4 Phone Number Health** [BOTH]
- Identify numbers flagged as spam by carriers (if detectable)
- Numbers with high bounce/invalid rates
- Recommend number rotation

**10.5 GDPR/Privacy Audit** [BOTH]
- Are consent fields being captured?
- Are opt-in/opt-out preferences tracked?
- Data retention: contacts older than X years with no activity - suggest cleanup

**10.6 TCPA Compliance Monitor** [BOTH]
- DND list compliance checks
- Calling time restrictions (no calls before 8am or after 9pm local time)
- Consent tracking for SMS

**10.7 Sending Volume Monitor** [BOTH]
- Daily/weekly email and SMS sending volumes
- Alert when approaching provider limits
- Usage trend to predict future costs

**10.8 Blacklist Check** [BOTH]
- Check if sub-account domains or IP ranges appear on email blacklists
- External check (use available blacklist lookup APIs)
- Critical for email deliverability

---

## 11. PLATFORM INTELLIGENCE (6 features)

**11.1 Sub-Account Setup Score** [AGENCY]
- Beyond onboarding checklist: how WELL is each sub-account set up?
- Score based on: number of workflows active, pipeline configured, calendars set up, forms created, A2P registered, DNS configured, team members added
- "Client X setup score: 34/100. Missing: workflows, DNS, A2P registration."

**11.2 Feature Adoption Dashboard** [AGENCY]
- Which GHL features is each sub-account actually using?
- Using: CRM, Pipeline, Calendar, Workflows, Forms, Funnels, Reviews, Courses, etc.
- "Client X is paying for GHL but only uses CRM and Calendar. Opportunity to drive value."

**11.3 App Usage Analytics** [BOTH]
- How often does the user open SubSync?
- Which SubSync features are used most?
- SubSync's own product analytics for improving the app

**11.4 Integration Health Monitor** [BOTH]
- Is the GHL connection healthy?
- Token expiry warning
- API error rate monitoring
- "Your connection to GHL is having issues. 15 API calls failed in the last hour."

**11.5 Data Sync Status** [BOTH]
- Per sub-account: last sync time, records synced, errors
- Sync history with success/failure log
- Manual resync trigger

**11.6 Account Capacity Planner** [AGENCY]
- Based on current team size and performance metrics:
- "Your team can effectively manage X sub-accounts. You currently have Y. You're at Z% capacity."
- Suggests when to hire based on workload trends

---

## 12. AI-POWERED INTELLIGENCE (10 features)

**12.1 AI Daily Action Brief** [BOTH]
- See MOAT_FEATURES.md M1

**12.2 AI Deal Risk Scorer** [BOTH]
- See MOAT_FEATURES.md M2

**12.3 Predictive Show Rate** [BOTH]
- See MOAT_FEATURES.md M3

**12.4 AI Coaching Suggestions** [BOTH]
- See MOAT_FEATURES.md M4

**12.5 Smart Anomaly Detection** [BOTH]
- See MOAT_FEATURES.md M5

**12.6 Natural Language Query** [BOTH]
- Type a question in plain English: "How many no-shows did we have last week across all accounts?"
- SubSync interprets and returns the data
- No need to navigate dashboards for simple questions

**12.7 AI Summary per Sub-Account** [AGENCY]
- One paragraph AI summary per client: "Client X had a strong week. 34 new leads, 12 appointments, 82% show rate. Pipeline grew by $24K. One concern: response time averaged 22 minutes, up from 8 minutes last week."
- Generated from data, not generic text

**12.8 Trend Explanation** [BOTH]
- When a metric changes significantly, AI explains possible causes
- "Show rate dropped 18% this week. Possible factors: 65% of appointments were booked 5+ days out (historically lower show rate), and 3 new leads came from a cold outreach campaign with historically low show rates."

**12.9 Predictive Lead Scoring** [BOTH]
- Beyond rule-based: ML model trained on conversion data
- Predicts which leads are most likely to become customers
- Requires 90+ days of data to train
- Gets more accurate over time = moat

**12.10 Auto-Segment Discovery** [BOTH]
- AI identifies natural groupings in contacts
- "Your contacts cluster into 3 segments: high-intent fast-closers (15%), price-shoppers who need nurturing (45%), and tire-kickers who rarely convert (40%)"
- Suggests different approaches per segment

---

## 13. GAMIFICATION & ENGAGEMENT (6 features)

**13.1 Setter Gamification** [BOTH] - See MOAT_FEATURES.md M6
**13.2 Team Activity Heatmap** [BOTH] - See MOAT_FEATURES.md M7
**13.3 TV Dashboard Mode** [BOTH] - See MOAT_FEATURES.md M8

**13.4 Daily Challenges** [BOTH]
- Auto-generated daily challenges based on team metrics
- "Today's challenge: The first setter to book 3 appointments wins bragging rights"
- Optional small prize tracking

**13.5 Team Streak Counter** [BOTH]
- Track team-wide streaks: "Your team has responded to every lead within 5 minutes for 8 consecutive days"
- Builds team accountability
- Visible on dashboard

**13.6 Monthly Awards** [BOTH]
- Auto-calculated monthly awards based on data
- "October MVP: Sarah (highest close rate)"
- "Most Improved: Alex (response time improved 60%)"
- "Iron Will: Mike (most calls, 847)"
- Exportable as image for social media

---

## 14. CLIENT-FACING FEATURES (6 features)

**14.1 Shareable Client Dashboard** [AGENCY] - See MOAT_FEATURES.md M9
**14.2 Scheduled PDF Reports** [AGENCY] - See MOAT_FEATURES.md M10
**14.3 White-Label Dashboard** [AGENCY] - See MOAT_FEATURES.md M11

**14.4 Client Feedback Collection** [AGENCY]
- Embedded satisfaction survey in client dashboard
- NPS scoring
- Feedback trends per client

**14.5 Client Knowledge Base** [AGENCY]
- Per client: store important notes, SOPs, preferences
- "Client X prefers no calls after 6pm"
- "Client Y wants weekly reports, not monthly"
- Accessible by any team member working that account

**14.6 Client Activity Log** [AGENCY]
- Everything the agency has done for a client this period
- Auto-generated from SubSync and GHL activity data
- "This month we generated 45 leads, booked 18 appointments, closed 4 deals worth $32,000"
- Proof of value for client retention

---

## TOTAL FEATURE COUNT: 184 features across 14 categories

---

## BUILD PRIORITY SUMMARY

**Immediate (Priority 1 - next 2-3 weeks):**
Appointment Intelligence (1.1, 1.2, 1.4), Speed-to-Lead (4.2, 8.8), Unified Inbox (4.1), Smart Call Queue (8.1, 8.2), Weekly Summary Email (6.3/6.4)

**Month 2 (Priority 2):**
Setter Leaderboard (5.1), Pipeline Funnel (2.1), Deal Velocity (2.2), Engagement Score (6.1), Churn Risk (6.2), Response Time Dashboard (4.2)

**Month 3 (Priority 3):**
Revenue Forecasting (2.4), Win/Loss (2.5), AI Daily Brief (12.1), Goal Tracking (7.7), Gamification (13.1), Call Outcome Logger (8.4)

**Month 4+ (Priority 4):**
Everything else, ordered by user demand once the first 3 months of real customers provide feedback.

---

## PRICING (revised with sub-account mode)

**Business Mode (sub-account app, single business):**
- Free: Basic dashboard, limited metrics
- Starter: $9/month - appointment intelligence, speed-to-lead, pipeline dashboard, smart call queue
- Pro: $19/month - everything + AI features, forecasting, gamification, scheduled reports

**Agency Mode (agency app, cross-sub-account):**
- Free: Up to 3 sub-accounts, basic cross-account search + onboarding checklist
- Growth: $29/month - up to 15 sub-accounts, unified inbox, setter leaderboard, appointment intelligence, smart call queue
- Scale: $59/month - up to 50 sub-accounts, everything + engagement scoring, churn alerts, pipeline intelligence, weekly digest, AI features
- Enterprise: $99/month - unlimited sub-accounts, everything + white-label, client portal, QBR generator, ROI dashboard, TV mode
