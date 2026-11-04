# Unanswered messages: the money test, the overlap with Speed to lead and Today, and a review of the old screen (5 Nov 2026)

King's words: customer first, money first ("is this sellable, does it resolve a pain point, will customers buy"); sexy and lovable, not overwhelming; it must work for agencies AND for client-account users (setters, business owners) and on a phone; add the features that are missing; one-click call and email from a person through the CRM.

## Part 1. The money-first test (in plain words)

**1. The pain it removes.** A customer who wrote and heard nothing does not wait politely: after a day they write to a competitor, and the business never learns that it lost them. This is not only new leads (Speed to lead has those): it is the person who already bought and asks "can we move Friday?", the lead who replied to a text three days later, the one who messaged on Instagram where nobody looks. Every one of them is money the business already paid to win (an ad, a referral, a past job) and is now losing for the price of one reply.

**2. Who feels it.** The **setter or front desk** ("who do I answer first?"). The **business owner** ("am I losing people while I am on a job?"). The **agency owner** ("which client is leaving customers on read, and whose customers are they?"). A **client's own staff** see their own account's queue and no ranking of colleagues.

**3. The number and action that prove it in five seconds.** On the demo company the first screen now says: **"46 people are waiting for a reply across 9 clients. The longest has waited 4 days."**, then one button, **"Reply to the oldest of the 46 people waiting"** (it opens that conversation in the CRM), then one line: **"About $149,457 of business may be at risk (an estimate)"** with its formula one tap away (people waiting x the client's average deal x its win rate, only for clients with at least 20 closed deals; clients without are counted as left out, never guessed; the same formula as the Account audit and Speed to lead).

**4. Why would they pay for this, not use the CRM's own inbox filter?** Said honestly:
- The CRM's inbox is one account at a time and is built for typing replies. As far as I know (INFERENCE, not re-checked in the CRM's help pages today) it cannot give an agency one list of everybody waiting across 40 clients, ranked by client, with the longest wait first, and it does not say who the customer belongs to or what the wait costs. That cross-account view and the "who owns them" view are what an agency or an owner cannot get without opening every account.
- It is not an inbox and does not send anything: it is the order of work, the proof (a number the owner can show a client) and the nag (the existing alerts and digest read the same count).
- Honest verdict: the **screen earns its slot, but only just, and only because it is different from Speed to lead** (next part). The CRM's own filter would replace it for a single small business that lives in the inbox all day; the paid part is the agency view and "who owns them".

**5. What to cut.** Cut in the rebuild: the Unread tab and list (unread is a different thing: the CRM's inbox and Today's tile have it; this page says so in one line), the three tabs, the five wait chips, the saved-views drawer (four choices do not need saving; the saved-view answers stay in the server for later), the row of four dropdowns, the second chart as a chart (clients become a ranked list), the "Also in this queue" peeks, the 6-column table, "Copy list", the always-open how-to banner, and the Export CSV button for a client's staff (the server never allowed it: it would have failed). Not built on purpose: a message snippet (see "What is missing, honestly"), a reply box, a dialer, assigning anyone from SubSync.

## Part 2. The overlap with Speed to lead and Today, and why this screen is different

| | Speed to lead | Today, "Reply now" | **Unanswered messages** |
|---|---|---|---|
| Who | **New leads** (a new contact with a conversation, last 14 days) | Everyone waiting, all kinds, top 5 | **Anyone whose conversation has the customer's message last**: new leads, existing customers, past customers |
| Age | 14 days | 14 and 30 days | **Up to 30 days**, in four wait buckets (1 to 4 h, 4 to 24 h, 1 to 2 days, 2 days or more) |
| Channel | Any, but the clock is the *first* reply | Not shown | **Channel in every row and as a filter** (text, email, WhatsApp, Facebook, Instagram, live chat, call) |
| What is measured | Time to the *first reply by a person* (an automatic text is not a reply) | A count of people | **Whether the last thing in the thread is the customer's**, and for how long |
| Ranking | Clients by share answered in time; people by typical reply | Clients needing you | **Clients by people waiting; the people who own the customers** |
| Reply goes to | The contact | The contact | **The exact conversation** |

On the demo, **46 people wait on a conversation here and only 1 of them is a new lead**. Today shows 94 because it also counts 48 new leads nobody has replied to (form fills, leads that only got an automatic message), which Speed to lead lists. The two screens are almost disjoint: Speed answers "who just raised a hand and is cold", this one answers "who is already talking to us and is being ignored". That is the reason it keeps a menu slot. What it does NOT do is repeat Speed's measuring: no first-reply times, no per-client reply target, no source table.

If the menu ever needs to be shorter, the honest option is to make this a second tab of Speed to lead ("New leads | Existing customers"). It was not done here (the navigation is outside this stage).

**Agreement with Today** (see `docs/METRICS.md`, "Unanswered messages, second pass"). Today's "waiting for a reply" is a person counted once, merged by `mergeReplies` from two lists. This page lists the people who have a waiting conversation, by the same `waitingState` rule and the same one-person-once key. The only difference is the new leads who have no waiting conversation, and the page says it in one line: *"Today shows 94 because it also counts 48 new leads nobody has replied to yet."* **Today = people here + those new leads**, by Today's own function; this is unit tested on a fixture and live on the demo for the agency, a business owner and a client's staff.

## Part 3. The old screen, reviewed

Reviewed on the demo company with real screenshots at 1440, 768 and 390 for the four roles (agency, all accounts; agency inside one account `?as=location`; a client's staff `?as=client`; a business owner `?as=business`): `docs/review/unanswered-old-<role>-<width>.png` (and `-full.png` for the whole page). The rebuilt screen is photographed the same way: `docs/review/unanswered-<role>-<width>.png`. (The first batch of old phone and tablet shots was taken while the new code was being written and hot-reloaded, so they were retaken from an untouched checkout.)

Heights of the old page: agency 2,318 px at 1440, 4,097 at 768, **4,344 at 390**; a business owner or a client's staff 1,987 / 3,028 / 3,127.

**What is confusing, repeated or missing (each seen on the screenshots or in the code):**

1. **"Conversations" and "people" are two numbers for one fact.** The headline says "50 conversations are waiting". Today says "N people". A person with three waiting threads is three here and one on Today. The old tab counts ("Last 7 days (50)", "Unread (46)") read as if the two lists were two problems.
2. **The tabs mislead.** "Last 7 days" holds everyone who waited between the target and a week (here all 50 have waited 3 to 5 days), "Older (0)" is empty on any normal account, and "Unread (46)" is a different question that shares the same table. A setter has to understand three tabs to find the first person to answer.
3. **A wall of controls before the first row.** A how-to banner, four dropdowns (channel, client account, assigned to, order), a saved-views drawer, two charts side by side, a tab bar, five wait chips, a sentence about the tab, and only then the table. At 1440 the first person to reply to is at about y = 1,210; on a phone it is about 2,100 px down.
4. **No one thing to do.** The page says "What to do: start at the top of the Last 7 days tab". There is no button.
5. **The list is a report.** Six columns, "Reply in your CRM" as a text link, no call, no email, no phone, no search, no "mine". The row opened the customer panel from the name only. At 100 accounts "View all 50" becomes "View all 5,000" with no server paging.
6. **Pills and badges** (KF-1): "Waiting 5 days" in a red outlined badge and "1 unread" in a blue one on every row, "No owner" in an amber badge.
7. **The charts do not answer a question.** The wait chart had seven buckets, three of them always 0 ("Under 1 hour", "1 to 4 hours", "Older than a week" with a 4-hour target); the client chart listed every client with its own scale and "Other accounts (1)". Press a bar and a panel opened under both charts, away from the list.
8. **Export CSV is shown to a client's staff** but the server refuses that route for them (it is a business and agency route), so the button leads to an error.
9. **"Assigned to: Team member (name not available)"** on three of seven rows for a business owner, with a paragraph at the bottom explaining it. The name state is already solved elsewhere (`resolveUser`: "Former team member", "Name not loaded yet", "Needs permission: reconnect").
10. **The count can look wrong next to Today** and nothing explains it (Today 94, here 50): no new-lead explanation, no link.
11. **No money.** Nothing says what a waiting person is worth.
12. **A phone is a stack.** Each row at 390 is five label and value lines (about 130 px), three people fill a screen, the reply link is a text link under 44 px, and the page is 4,344 px tall.
13. **Words.** "Customer messages that are still waiting for a reply. Late means past your reply target; change it in Settings." and "The customer wrote last, more than 4 hours ago (your reply target), in the last 30 days. Older than that is not counted." say the same thing twice.
14. **Missing, expected by a customer:** call and email through the CRM, a warning before calling someone who asked not to be contacted or at night, "mine" for a setter, a copyable and printable summary, an all-clear that says what to do next, and a count that matches Today.

**What the rebuild does about each point:**

| # | What changed |
|---|---|
| 1, 2, 10 | A person is counted once (Today's key). One sentence: "46 people are waiting for a reply across 9 clients. The longest has waited 4 days." One line explains Today's number and links to Speed to lead. Unread is one footnote line, not a tab. |
| 3, 4, 5, 12 | Header, sentence, one button, five rows, then the rest. Each row: name (opens the person panel), one reason line, the wait, ONE small Reply button (44 px on a phone) and a three-dot menu (Show person, Call in your CRM, Email in your CRM, Copy details). "See all 46" opens the full list in place: searched, sorted, filtered by wait, channel and owner, paged 25 on the server. |
| 6 | Plain status words and colour only for the wait (24 hours to a week in the warning colour, a week or more quiet, never an alarm); no pills, no boxes. |
| 7 | One chart: how long they have waited, three or four bars (a bar that cannot hold anyone under the reply target is left out), each bar is one button whose number is the number in its list (KF-6). Clients are a ranked list: top 5 and "See all N" (searched and paged on the server). Inside one account the ranking is of the people who own the customers. |
| 8 | The menu offers the download only to people the server allows. |
| 9 | Owner names use the one shared label rule. "No owner" is a row of its own in the ranking and a chip in the list. |
| 11 | The labelled estimate and its formula one tap away (the audit's formula). |
| 13 | Rewritten with the UX copy skill (see `docs/features/UNANSWERED.md`). |
| 14 | Call and Email in the row menu through the white-label link (never `tel:`, never a sent message), the do-not-disturb and calling-hours warning before a call, a "Mine" chip, Copy a summary and Print, an all-clear with a next best step. |

## What is missing, honestly

- **A message snippet.** The brief asked for the last message's words in the row. SubSync keeps only who wrote, when and through which channel; message text is never copied (a promise on the Trust page and on this screen, N75). Storing it would need a new column, the conversation-messages permission and a changed privacy statement, which only King can decide. So a row says who, which channel, how long and who owns them, and Reply opens the message in the CRM. Proposal in `docs/features/UNANSWERED.md`.
- **Who a conversation is assigned to.** The conversation list does not say; the page uses the contact's owner and says so.
- **Calls.** The last action may be a call; SubSync cannot tell whether it was answered, so the row says "Call, result not known".
- **Saved views, an unread list, a chart of unread** were cut on purpose (above).
