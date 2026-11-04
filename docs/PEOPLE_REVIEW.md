# People: the money test, and a review of the old screen (5 Nov 2026)

King's words: customer first, money first ("is this sellable, does it resolve a pain point, will customers buy"); sexy and lovable, not overwhelming; it must work for agencies AND for client-account users (setters, business owners) and on a phone; add the features that are missing; one-click call and email from every lead and list by opening the CRM's own dialer and mail box through the white-label link; the lead panel must show the tags with the day each was added and the lead's timeline, and it must open from every chart mark and every list.

## Part 1. The money-first test (in plain words)

**1. The pain it removes.** Two things, both daily, both in the setter's hands:
- **"Where is she?"** A customer calls back, or the owner says "did anyone speak to the Patels?". The person is in one of 40 client accounts and the CRM searches one account at a time: you have to know which account first, switch into it, search, open the contact, and then read five tabs to learn what happened (the message here, the appointment there, the deal on a third tab). A setter cannot find the person, or cannot see what happened with them, in less than a minute.
- **"Who do I call next?"** Calling lists live in spreadsheets and in people's heads: the new leads nobody answered, the no-shows to rebook, the hot leads that went quiet, the deals that stopped moving. Each is a different screen in the CRM (or no screen at all), so the list is rebuilt by hand every morning, and a person who asked not to be contacted still ends up on it.

**2. Who feels it.** The **setter** (a client's own staff: their queue, their calls, nobody else's clients). The **business owner** (did we call back everyone this week?). The **ops person or VA at the agency** (find a person across all clients, fast). The **agency owner** (are my clients' people being called?).

**3. The number and action that prove it in five seconds.** The first thing on the page is a search box ("Search by name, phone or email", across every client account) and under it one sentence and one button: **"48 new leads are waiting for a reply. Also: 8 no-shows, 188 hot leads, 43 stale deals." [Start with James Walker]**. Press it and the person opens with one headline ("Never answered. Waiting 14 days."), a Call button, the tags with the day each was added, and what happened, then an arrow to the next person on the same list. Type "lov" and the person is found in any client, with the same headline.

**4. Why would they pay for this rather than use the CRM's own search and lists? (said honestly).**
- The CRM's search and smart lists work inside **one client account**. An agency has no single search and no single "who to call" list. SubSync reads them all at once, and a client's staff get the same screen cut to their own account.
- The CRM's lists are filters; they do not say **why** someone is on them or rank by urgency. SubSync's five lists are the ones SubSync's other pages already agree on (waiting for a reply = Speed to lead and Today; no-shows = Appointments; stale deals = Today), so the count on a chip is the count on the other page.
- The CRM does not say **when a tag was added** and does not show the person's messages, calls, appointments, deal moves and tag changes on one timeline; SubSync's panel does (from the day it started watching; the screen says so).
- It warns before a call or an email to someone who asked not to be contacted, and outside calling hours.
- It does **not** replace the CRM's dialer or mail box and it sends nothing: Call and Email open the person in the CRM (the CRM publishes no link straight to its dialer, and the screen says so once).
- Honest verdict: **search on its own is not a reason to pay** (a single-account owner finds people fine in the CRM). The reason to pay is the five lists plus the panel: it is the thing a setter keeps open all day, and every other SubSync page opens the same panel. It only sells if the lists are right on real data, which is why each list is read through the function its own page uses and the count equals the rows (tested).

**5. What to cut.** Cut in the rebuild: the 14-control filter form as the first thing on the page (it is behind one "Filters" button now), the separate Smart lists tab (saved lists are chips beside the five lists), the "How to use this page" banners, the four statistic tiles and the "power hour" timer of the old call lists (a clock and tiles that nobody asked for; logging how a call went stays, in the panel), the priority score in a tinted badge on every row (KF-1), the small text link in the Phone column (a button column and a row menu now), the 7-column table (one line of name, one line of reason, one button).

## Part 2. The old screen, reviewed

Reviewed on the demo company with real screenshots at 1440, 768 and 390 for the four roles (agency all accounts, agency inside one account `?as=location`, a client's staff `?as=client`, a business owner `?as=business`): `docs/review/people-old-<role>-<width>.png` (the page) and `docs/review/people-old-panel-<role>-<width>.png` (the first person opened). The business owner's panel at 390 was not kept: it was photographed after the new code began to reload and shows the new panel; the same old panel is in the other roles. The rebuilt screen is photographed the same way: `docs/review/people-<role>-<width>.png`.

**What is confusing, repeated or missing (each seen on the screenshots or in the code):**

1. **A form, not a person.** At 1440 the first thing on People is a how-to banner, then **14 controls** (a name box, 11 drop-downs and date boxes, 2 tick boxes) and a "Save as a smart list" row, and the first person starts below the first screen (about y = 885 of 900). At 390 the same form is 11 stacked controls, about 1,700 px, before the first name. The person came to find someone; the page asks them to build a query.
2. **The page is about the tool, not about the work.** Nothing says "34 people need a call". The call lists were a different tab ("Smart lists", under "Call lists") with their own dropdown, four tiles (calls logged, reached) and a "power hour" clock.
3. **The setter was denied the call lists.** A client's staff (the people who actually make calls) do not have the Call lists at all: the route and the menu entry are agency and business only, so their "Smart lists" tab showed only saved filters. (The new screen gives them the same five lists cut to their own account, starting on their own queue.)
4. **A number on every row that means nothing.** The call list shows a priority score (70, 40...) in a tinted badge beside each name (KF-1) with no words; "Last call, tries, result" says "Not called from SubSync" on almost every row; seven columns on a laptop, stacked label/value blocks on a phone.
5. **Dialing is a text link.** In the list "Call in your CRM" is a small underlined link inside the Phone column (36 px high, not a button column, so the actions do not line up from row to row); in the panel it is the same link with three lines of explanation and the Dialer drop-down under the number. There was no Email action in any list (only "Email in your CRM" in the panel), no Copy and no row menu. The do-not-disturb warning existed before a call, but the row only said "Do not disturb" in small text under the number.
6. **The panel opens empty.** At 1440 the lead panel shows the name and an empty loading block for several seconds (the demo took 3 to 10 s) before anything useful; the first useful thing is a phone number and a link. There is **no headline**: nothing says who this person is to you or what to do. The owner shows as "Team member (name not available)" on a client's own screen.
7. **The timeline is thin.** From the code (`contactTimeline`): contact added, deals created and moved, and **one** line for the last message. No calls, no appointments (they were a separate list), no tag changes, no first reply. "Notes and tasks are not shown yet" printed on every panel.
8. **Tags show a date only after a second request.** The day each tag was first seen needed a second call; the note about what the date means was there, but the tag section was a row of small bordered boxes (not a list you can scan), and the per-day tag chart lived at the bottom of the search tab under a form.
9. **No memory.** Nothing says what changed since the person last looked, and no recent searches or recently opened people, so a setter returning to "the Patels" starts from nothing.
10. **Search is a filter among filters.** The search box is a form field (not the page), has no way to stop at two letters versus a phone number, counts every match even for two letters (the count scans all matches), and shows "4,355 people" for an empty search.
11. **Keyboard and phone.** The panel arrows work, but the list has no keyboard movement, the panel does not trap focus, the arrows are 40 px (under the 44 px thumb size), and the Call text link is 36 px high.
12. **Words.** "Smart lists", "Imports and sources", "Dial" (a word the person never uses; they "call"), "Working or cold" and "Without the tag" are tool words.

**What the rebuild does about each point:**

| # | What changed |
|---|---|
| 1, 2, 10 | The page opens on a search box, then one sentence and one button (the most urgent of the five lists), then the lists. The filter form is behind "Filters". Search answers a page at a time on the server and counts exactly up to 10,000 then says "10,000+". |
| 3 | A client's staff get the five lists, cut to their own account on the server, starting on "Mine" when anything is assigned to them. They may log a call on their own account's people. |
| 4, 5 | Rows are one line of name, one line of reason ("Never answered, waiting 3 h · Owner Priya Shah"), one small Call button and a three-dot menu (Show, Call, Email, Open in your CRM, Copy details). The CRM note is said once per page. A do-not-disturb person is marked on the row and a stop is shown before any call or email. |
| 6, 7, 8 | The panel opens with the headline and the one next step, then the Call and Email buttons, then the facts; the tags carry the day SubSync first saw them (with the honest note); the timeline merges messages and calls (read live, never their words), appointments and their status changes, deal moves, tag changes, the first reply and calls logged in SubSync. |
| 9 | "Since you last looked" per person, recently opened people, recent searches (kept on the server for that person alone, clearable). |
| 11 | j and k move through a list's names, arrows or j and k move through the panel, the panel traps focus and gives it back, targets are 44 px on a phone. |
| 12 | Plain words: Find and call, Tags, Going cold, Sources, Call, Email. |
