# Speed to lead: the money test, and a review of the old screen (5 Nov 2026)

King's words: customer first, money first ("is this sellable, does it resolve a pain point, will customers buy"); sexy and lovable, not overwhelming; it must work for agencies AND for client-account users (setters, business owners) and on a phone; add the features that are missing; one-click call and email from every lead through the CRM; the lead panel shows tags with the day each was added, and a timeline.

## Part 1. The money-first test (in plain words)

**1. The pain it removes.** A new lead is a person who just raised a hand. The business that answers first usually gets the job, and every minute after that the lead gets colder; a lead nobody answers is money already spent on ads, forms or referrals and then thrown away. Everyone in an appointment business knows this and almost nobody measures it:
- The CRM shows a conversation and a "first response" per client account, but a workflow's instant automatic text looks like a fast reply, so a team can look fast while no human ever answered. SubSync keeps the automatic first message apart from the person's reply.
- The owner cannot see which leads are waiting right now, who owns them, or which setter is slow, without opening every account.
- An agency with 40 clients cannot answer "which client is losing leads this week?" in one place.

**2. Who feels it.** The **setter** (what do I reply to first?). The **business owner** (am I losing customers I paid for?). The **agency owner** (which client, which person, and is it worth my time or theirs?). The **client's own staff** (my queue, not a ranking of my colleagues).

**3. The number and action that prove it in five seconds.** On the demo company the first screen now says, in this order:
**"49 leads are waiting for a reply across 12 clients. 42 of them were never answered."** then one button, **"Reply to the oldest waiting lead"**, then one line: **"Typical first reply 24 min in the last 30 days, from 241 replies. About $125,398 of business may be at risk (an estimate)."** The estimate is labelled, has its formula one tap away ("How this is worked out": leads waiting x the client's average deal x its win rate, only for clients with at least 20 closed deals; clients without are counted as left out, never guessed), and uses the same formula as the Account audit. A real account shows its own numbers.

**4. Why would they pay for this rather than use the CRM's own reports?** Said honestly:
- The CRM's reports are per client account, show an average, and cannot tell a robot's reply from a person's. SubSync separates the two ("50 leads only got an automatic message and no person replied" is the finding that makes an owner open their wallet), ranks across all clients, names the slow person, and puts the leads behind every number one tap away.
- It does not send anything and is not a dialer. Its value is the order of work (longest wait first), the proof (a number the owner can show a client) and the nag (alerts, digest) that already exist elsewhere in SubSync.
- Honest verdict: this is the **core of the product**, the thing the other modules feed. On its own, the "typical reply" part is something the CRM nearly does; the paid part is "who is waiting NOW, who owns it, who is slow, and what it costs", delivered to the person who can act, with the same count in Today, the digest and the alerts. It only sells if the numbers are right on real data, which is why every figure is one function and one selection (section "What the rebuild does").

**5. What to cut.** Cut in the rebuild: four of the five stacked cards (the page was 4,184 px tall at 1440), five separate range pickers (now one, plus one on the optional source table), the how-to banner that took the first screen, the "what to do" sentence, the amber "no owner" banner (KF-1), the always-open paragraph about automatic messages, the 13-row table of every client (top 5, search and page for the rest), and the leaderboard that a client's own staff could see. Not built on purpose: a dialer, sending a reply, assigning a lead from SubSync (the suggestion is a display, nothing is written to the CRM).

## Part 2. The old screen, reviewed

Reviewed on the demo company with real screenshots at 1440, 768 and 390 for the four roles (agency all accounts, agency inside one account `?as=location`, a client's staff `?as=client`, a business owner `?as=business`): `docs/review/speed-old-<role>-<width>.png` (and `-full.png` for the whole page). The first look at 1440 for a client's staff failed to capture (the capture waited for a heading that screen does not have), so that role is judged from 768 and 390. The rebuilt screen is photographed the same way: `docs/review/speed-<role>-<width>.png`.

**What is confusing, repeated or missing (each seen on the screenshots or in the code):**

1. **Three numbers for one fact.** The headline said "8 leads are waiting for a reply, and 42 were never answered", the list under it said "Leads waiting or missed (50)", and Today counts the same people as "of which N are new leads". The old headline counted "never answered" as a different group from "waiting", which is the opposite of the rule Today uses (a person is counted once, never answered is a subset). A customer who opens both pages sees two different totals.
2. **A wall.** At 1440 the page is 4,184 px tall: a warning, a how-to banner, the headline, a "what to do" line, a measuring paragraph, a 6-column table, a left-out line, an amber no-owner banner, then five cards, each with its own range picker ("Last 30 days / No comparison" five times). The first lead to reply to starts at about y = 550.
3. **The list is a report, not a queue.** Ten rows of six columns, "Open contact" text links, no call, no email, no phone, no search, no sort, no page ("View all 50" showed 10 of 50 and a "Copy list"). A setter cannot act from it, and 100 accounts would be 100 times worse.
4. **No reply button.** The one verb of the page ("reply") appears nowhere; the link says "Open contact".
5. **Pills and tinted banners** (KF-1): "never answered (14 days)" in a red-outlined badge on every row, the amber no-owner banner, the warning banner and the how-to banner.
6. **The numbers have no money.** Nothing says what a waiting lead costs. The page measures and never says why it matters.
7. **Charts that do not answer a question.** "Are replies getting faster?" at 90 days showed five empty bars because only 56 days of history exist; a note below explained it. The "by client account" table listed all 13 clients, every one with a 0% or 46% and no way to act (at 100 clients it is 100 rows).
8. **A leaderboard for everyone.** "Who replies fastest" (names, typical times) was shown to a client's own staff at 768 and 390. Staff should see their queue, not a ranking of colleagues. (The server did not hide it either.)
9. **Automatic message section is a paragraph** of 60 words before the finding ("50 still have only the automatic message"). The finding is the product; the explanation should be one tap away.
10. **One global reply target.** A roofer and a dental clinic have the same 15 minutes; the page could not say "this client's target is 30".
11. **Missing, expected by a customer:** call and email from a lead through the CRM, a warning before calling a "do not disturb" person or at night, who should reply to a lead nobody owns, "mine" for a setter, a copyable and printable summary, a calm all-clear with a next step, and a count that equals Today's.
12. **Phone (390).** The six-column table becomes stacked label/value blocks about 110 px high each, so three leads fill the screen; the buttons are text links under 44 px.
13. **Words.** "Needs permission: reconnect. Reading the messages inside conversations needs a permission that 1 of 13 accounts have not approved yet" is two sentences where one would do; "Leads waiting or missed" is two verbs for one idea.

**What the rebuild does about each point:**

| # | What changed |
|---|---|
| 1 | One function (`waitingFacts`) counts the leads waiting; they are exactly Today's "new leads" (tested against Today's own `mergeReplies` and `countsOf`, and live on the demo for three roles). "Never answered" is "N of them". |
| 2, 3, 4, 12 | One sentence, one button ("Reply to the oldest waiting lead"), five rows with one small Reply button (44 px on a phone) and a three-dot menu, then "See all 49" (server searched, sorted and paged, 25 a page). Everything else is below, and the optional source table is behind "More detail". |
| 5 | Plain status words and a thin rule; no pills, no tinted boxes (the only box left is the one-line permission note). |
| 6 | The labelled estimate and its formula one tap away. |
| 7 | One weekly chart only when the range holds two or more weeks; one comparison "who is slow" with the top 5 and See all (paged, searchable, server side). |
| 8 | Hidden from a client's staff on the server (`seePeople`), not only on the screen. |
| 9 | One line: "50 of these only got an automatic message and no person replied. Show them." The explanation is in the measuring note at the bottom. |
| 10 | Each client account can have its own target, typed inline ("You type this number. SubSync does not read it from your CRM."), saved for that client only. The default stays in Settings. |
| 11 | Call and Email in the row menu through the white-label link (never `tel:`, never a sent message), the do-not-disturb and calling-hours warning before a call, "Mine" and "No owner" chips in the full list, a suggested replier for a lead nobody owns (a display only), Copy a summary and Print, an all-clear with a next best step. |
| 13 | Rewritten with the UX copy skill (see `docs/features/SPEED.md`). |

**Agreement with Today.** "Waiting for a reply" is Today's counting rule (a person is counted once; `docs/METRICS.md`, "Today, third pass"). Speed counts leads, so its number is the subset Today calls "new leads". Where Speed legitimately differs (the first reply time and the judging of past leads, not "who is waiting now"), it is defined in `docs/METRICS.md`, "Speed to lead, second pass", and unit tested.
