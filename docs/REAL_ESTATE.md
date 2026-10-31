# Real estate: what the research says, and what SubSync does about it

Written overnight on 31 Oct 2026 after King asked for moat features for real estate companies that run sub-accounts. King works in
real estate marketing, so treat his corrections as better than anything below. Most figures here come from vendor blogs
(CRM, dialer and AI-receptionist companies that cite each other), so they are **labelled as practice, not measured fact**.

## What the sources agree on

- **Speed to lead is the core issue.** The usual benchmark is a reply inside 5 minutes. Reported averages are far slower (hours;
  one source says a median of 917 minutes). Channel targets seen: portal and phone leads under 5 minutes, web forms under 15,
  social messages under 60. The "21x" and "391%" conversion figures are repeated widely but are second-hand. Do not quote them to a client.
- **Routing is a pain point.** Portal leads are often sent to several agents at once, and a lead must reach the right agent, not any
  agent. Kixie (a competitor, so biased) calls it a "lead routing black hole".
- **Brokerages tend to give each agent or team a sub-account.** That gives isolation, and it is exactly the case where a
  cross-account view is valuable and the CRM's own reports (per account) are weak.
- **Show rate and no-show rescue matter.** Track show-up rate next to lead-to-appointment rate. One guide recommends a no-show rescue workflow.
- **Not found:** anything solid on long-nurture or re-engagement timing. Needs King's own knowledge or a separate search.

## What is built for this (live)

| Need | What SubSync does | Status |
| --- | --- | --- |
| Reply speed per lead source, with real-estate targets | Speed to lead now groups leads into Portals and phone (5 min), Web forms and chat (15), Social messages (60) and Other (the account target), each judged against its own target | Built 31 Oct, checked by unit test; first look on real data pending |
| Leads nobody owns ("routing black hole") | Speed to lead counts waiting leads that have no assigned person, flags each one, and shows a warning line | Built 31 Oct |
| Agent ranking across a brokerage's sub-accounts | Team: first-reply time, show rate, last reply and an idle flag per person | Built |
| Show rate and no-show recovery | Appointments: unmarked outcomes, no-show recovery list, show rate | Built, verified on real data |
| Instant proof for a brokerage owner | Account audit with a shareable link (names scrubbed) | Built |
| Real-estate industry targets and language | Playbook "Real estate and property" exists | Built, not yet reviewed by someone who works in real estate |

## Ideas for King to confirm or correct (not built)

1. **Past-lead re-engagement alert:** a contact who went quiet for 30+ days sends a new message. In real estate this is often the buyer who is finally ready. Needs conversation history we only just started recording.
2. **Stage names that mean something:** map pipeline stages to lead, contacted, showing booked, showing held, offer, under contract, closed, so dwell time reads in real-estate terms. Needs King's view of how teams really name stages.
3. **Duplicate portal leads across agents:** the same contact arriving in two agents' sub-accounts. Needs matching across accounts, with care for privacy.
4. **Lead cost by source and agent:** needs ad spend, which SubSync does not read.
5. **Listing and open-house follow-up:** depends on how King's clients log open houses.

## Questions only King can answer

- Which lead sources do your clients use most, and are the 5/15/60 windows right for them?
- Is "no owner" the right way to describe a routing failure, or do brokerages use round robin and shared inboxes?
- What do real estate teams call their pipeline stages?
- Should buyer leads and seller leads have different targets? (Sellers reportedly move faster.)
