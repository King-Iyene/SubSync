# Clients (the agency's client book): the money test, and a review of the old screen (5 Nov 2026)

King's words: "customer first, money first: is this sellable, does it resolve a pain point, will customers buy; sexy and lovable, NOT overwhelming; for agency users and, where it makes sense, a client-account user's own account health; phone-friendly; add the features that are missing." KF-7: fees, renewals, industry and notes are typed by the user and SubSync does not read them from the CRM; say so on screen.

## Part 1. The money-first test (in plain words)

**1. The pain.** An agency loses a client before it sees the warning. The account went quiet for six weeks, 20 people wrote in and nobody answered, the monthly check-in was skipped, and the first the agency hears of it is "we are not renewing". Renewal dates live in a spreadsheet or in somebody's head, so a renewal arrives unprepared. And at renewal the agency cannot prove what it delivered: the owner says "what do I pay you for?" and the agency has no one-page answer.

**2. Who feels it.** The **agency owner** (revenue walks out and they find out late; they carry every renewal conversation). The **account manager** (which of my 30 clients do I call this morning, and what do I say?). The **business owner who is a client** feels the other half: they want one plain answer to "is my account healthy?", and nothing about what their agency charges.

**3. The five-second proof.** The first thing on the screen is one sentence: **"3 clients look at risk, 2 renewals due within 30 days, $5,000 a month at stake."** (the demo's own numbers) with one button, **"Check in with the 3 clients at risk"**. The money is the monthly fees the agency typed for the clients that look at risk; the page says so.

**4. Why pay for this, when a spreadsheet or the CRM exists? (said honestly)**
- The CRM shows one account at a time. It has no "which of my clients may leave", no renewals across clients, no fee against value created.
- A spreadsheet holds fees and renewal dates but never learns that a client has gone quiet or has 21 people waiting. SubSync reads that from the accounts every day and puts it next to the fee and the renewal date.
- What is sellable: **the warning arrives before the client's complaint**, **every renewal is on a list with a countdown**, and **each at-risk client comes with the reason in numbers and a sentence to say** (text only, nothing is sent). The proof for renewal is on the client's page: new deals started in the last 30 days against the fee, a summary to copy or print.
- Honest limits: fees, renewal dates and industries are typed by the agency (SubSync cannot read what a client pays). "Value created" is an estimate (new deals are not money in the bank). Health is a warning sign, not a prediction. Nothing here has been tested with a real agency.

**5. What to cut.** The old screen showed the same clients four times (a "Who to call first" table, a four-bar chart, a 13-row, 9-column table, and a second table on another tab) with no money on the first one. Cut: the bar chart (the counts are now plain chips that open the list), the nine-column table (contacts, data %, open deals, stale and waiting are the audit's and Today's business), the separate "Details and billing" tab (fee, renewal and industry are typed in the row), the "What do these words mean?" box (every column explains itself in two lines), "Leave risk" as a second word next to health. Not built on purpose: sending reminders (display only), a fee import (a proposal), anything that writes to the CRM.

## Part 2. The old screen, reviewed

Photographed on the demo company at 1440, 768 and 390 for the agency (all accounts) and for a client's staff and a business owner: `docs/review/clients-old-<role>-<1440|768|390>.png` (`-full.png` for the whole page). The new screens are photographed the same way: `docs/review/clients-<role>-<width>.png`.

**What a client's staff and a business owner see:** "Not available. This page is not part of your view of SubSync." (correct, and tested, but a dead end). Their own account health is the generic "My account" page. The rebuild keeps them out of the book (server side) and does not show them fees or notes.

**What is confusing, repeated or missing on the agency screen (each point seen on the screenshots or in the code):**

1. **No money on the page that lists the clients.** Health, contacts, data %, open deals, stale, waiting: nothing about what a client pays or when it renews. Those were on another tab (Details and billing), so "who may leave and what does it cost me" took two tabs and a mental join.
2. **The same clients four times.** A "Who to call first" table (6 rows), a "Clients by health" bar chart, the full 13-row table, and the filter chips (At risk 3, Watch 3, Gone quiet 2, Incomplete data 4, Replies waiting 9, Ignored 1). The page is 2,633 px tall at 1440.
3. **Reasons without numbers.** "no activity for a long time · likely to leave" (how long?). For Metro Auto Repair the sentence was printed twice in one cell: "17 customers are waiting for a reply. The score says thriving, but 17 customers are waiting for a reply, so it is shown as at risk."
4. **Two different counts of people waiting.** The old page said 17 waiting for Metro Auto Repair; Today and the Account audit count 21 people. The old page used the account's own count of conversations past the reply hours; the other pages use one rule for people. A reader could not tell which was right. The rebuild uses the Account audit's rows (Today's rule) and never shows the old number.
5. **Three words for one idea.** "Health 82 Watch" next to "Leave risk Steady" next to "Gone quiet": a client could be Watch and Steady at the same time. One word per client now, with the reason.
6. **No first-use guidance for the typed values** (KF-7): fee, renewal and industry lived on the Details tab as "Add fee", "Add date", "Choose industry" in a six-column table, with tiles that said "Not set up yet" and "Needs fees". The column help sat in a closed disclosure.
7. **Renewals were a list in a tab nobody opens first**, 90 days wide, with no countdown on the Health tab.
8. **Open a client = a long report page** (the old account page): score breakdown, checklist, email authentication, stale deals, account controls. It had no fee, no renewal, no log, nothing to say, no value created.
9. **The row has no one action.** Name is a link, "Show trends" is a link, "Open in your CRM" is a link on another tab, and Log is a button on a third.
10. **Phone (390).** Rows are stacked label and value lines about 105 px tall ("Health:", "Why:"), the tab bar scrolls sideways, and a client's money is not there at all.
11. **Dot-and-pill badges** for health and risk on every row (KF-1), a large table at 100+ clients with no search by server, no paging (the table is built from every client in the browser), and "Export CSV" twice.

**What the rebuild does about each point:** (1) fee and renewal sit in the row beside health; (2) one ranked list: five rows who need you, "See all N clients" for the rest; the chart is gone and the counts are links; (3) the reason is a sentence with the number, taken from the same rules the other pages use; (4) one rule for people waiting, no-shows and quiet deals (the Account audit's), tested against it; (5) one word (At risk, Watch, Healthy, New, Not read yet) and, in the needs list, a renewal due is "Renewal due", never "Healthy"; (6) every column has two lines on press, the honest label is on the page, the first-use button is "Add your first client fee"; (7) "Renewals in the next 60 days", soonest first, with the countdown; (8) the client page: why, what to say, what changed, fee against value created, renewal and its dates to put in a calendar, the private log, trends behind one button; (9) one small button, "Open account", and a three-dot menu; (10) the phone rows are name, reason, then health, fee, renewal, with 44 px targets (tested at 390); (11) no pills, a server-paged list of 25 (tested at 150 clients).
