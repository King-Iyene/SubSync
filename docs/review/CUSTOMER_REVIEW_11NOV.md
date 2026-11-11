# Customer review, 11 Nov 2026

Method: dev server on demo data, four views (agency owner = default, agency staff = `?as=location`, client admin = `?as=client`, business owner = `?as=business`), desktop 1440 and phone 390, dark and light. Screenshots are in `docs/review/customer-review-11nov/` (name = view-width-theme-screen). Not every screen was captured in every combination (the demo server took 1 to 3 minutes per screen); see "Not covered".

The question asked of each screen: "why should I pay $11.50 per client account for this?"

## Top 15 problems, ranked by money impact

| # | Problem | Why it costs money | Evidence | Status |
|---|---|---|---|---|
| 1 | Three different "waiting" numbers with the same words: Today says 73 people are waiting, Unanswered says 49, People says 24 "new leads are waiting for a reply", Race says nobody. They are different lists (replies owed, never-answered new leads, both), but nothing says so. An owner who sees 73 then 49 stops trusting every number. | Trust is the product; a client doubting one count doubts the proof. | agency-1440-dark-today, agency-1440-dark-unanswered, agency-1440-dark-people | People wording FIXED ("have never had a reply"). Today still does not show "49 replies owed + 24 never answered". Open. |
| 2 | Race headline said "Every new lead has had a person reach out in time" beside "19% answered in time", "240 leads slow" and "$642,274 estimated cost". It described the live race only, and read as a lie. | The page that should prove value contradicted itself. | agency-1440-dark-pace | FIXED ("No new lead is waiting for a first reply right now.") |
| 3 | One $1,000,000 deal is 75% of the "$1,340,960 in quiet deals" on Today. Account audit warns about it; Today does not. "Do this first" also puts "Review quiet deals" (Soon) above "Reply to 19 people" (Urgent). | A fake-looking big number in the first sentence a buyer reads. Slow replies are the money that can still be saved today. | agency-1440-dark-today, agency-1440-dark-audit | Open. Needs a ranking rule decision (urgent replies first, or outlier note on Today). |
| 4 | The first screen of Speed to lead and its Unanswered tab is mostly chrome: filter bar, breadcrumb, freshness line, "Each account", title, subtitle, permission banner, tabs, search. The headline number starts about 560px down on desktop and about 780px down on a phone. | The value (who is waiting) is below the fold on the device setters use. | agency-1440-light-unanswered, agency-390-dark-unanswered | Partly fixed (items 5 and 6). Rest open: merge breadcrumb and freshness onto one line. |
| 5 | The freshness sentence appeared twice (header chip and the line under the filter bar). On a phone the demo sentence took 4 lines. | Clutter, repeated text. | agency-1440-dark-unanswered, agency-390-dark-today | FIXED (chip text is screen-reader only). |
| 6 | Date buttons wrapped to three lines each on a phone ("Last / 30 / days"), making the bar 90px tall. | Wasted fold on phone. | agency-390-dark-unanswered | FIXED (phone shows "7 days / 30 days / 90 days"; full words kept for screen readers and tests). |
| 7 | Appointments opens with two stacked notices (permission, "How this works") before the headline. | The no-show money ($7,241) and "33 appointments need you" start 540px down. | agency-1440-dark-appts | Open. |
| 8 | Clients opens with a four-line "How this page works" paragraph before the headline "4 clients look at risk, $6,200 a month at stake". | Same. | agency-1440-dark-clients | Open (dismissible). |
| 9 | Unanswered tab starts with a "Find anyone in any client" box and a More button before the headline. Global search already exists (Ctrl K) and People has search. | First control is not the money. | agency-1440-dark-unanswered | Open. |
| 10 | The filter bar on Today, Audit and People shows an empty bar with "Live, as of right now" on the right until the account picker loads, then the page jumps. | Looks broken on first load. | agency-1440-dark-audit, agency-1440-dark-people | Open (needs a placeholder the same height). |
| 11 | "What can I do here" guide had no entry for Unanswered. | New tab invisible to people who open the guide. | code | FIXED |
| 12 | "Right now (this page shows what is true at this moment)" is a long sentence in a full-width bar. | Noise on every live page. | agency-1440-dark-today | FIXED ("Live, as of right now", full text on hover). |
| 13 | "Speed by account" shows seven rings at 0% and one at 46%, unsorted by money. | The best-vs-worst client story is hidden. | agency-1440-dark-pace | Open (demo data, but also real when accounts are new). |
| 14 | River animation ends in 0, 0, 0 (booked, showed, became a customer) and the replay slider has no label. Reads as broken even though the note below explains it. | The best visual on the product ends on three zeros in demo. | river-1440-dark, river-390-light | Open. |
| 15 | Zero cards "No owner 0" and "Mine 0" sit beside the big number as full cards. Ownerless conversations are the most-voted pain, so a 0 is good news and could read as "none, good". | A zero shown as a card can look like missing data. | agency-1440-light-unanswered | Open. |

Dev-only (not customer problems): the Next.js dev badge covers the first menu item and the phone bottom bar.

## What a customer would love

- **"Where do my leads go?"** The river (298 in, 241 touched, drop-offs as buckets, replay) is the one screen an agency can screenshot into a client email. It reads on a phone as a vertical version without losing a step. See river-1440-dark and river-390-light.
- **Account audit** says one sentence of money ("leaking about $228,315 a month"), gives a low to high range, says how many people are too new to price, and warns when one deal is 75% of a number. That honesty is the selling point.
- **Appointments** gives a "true show rate" with a range until unmarked appointments are marked.
- **Client admin Today** is clean: nine people, one button ("Reply to Zoe Morgan"), five rows, "Reply" on each. A business owner needs nothing more.
- **Unanswered live hero** ("49 people are waiting across 9 clients. The longest has waited 10 days.") and the single "Open the oldest" button.
- Light and dark both hold up: contrast and focus were fine in every screen captured.

## Not covered

- Business owner and agency staff views were captured on Today only (desktop; business also on phone). Appointments, Clients and People as client admin, business owner and agency staff were not captured.
- Pace tab on phone dark and People tab of Speed to lead were not reviewed (the tab click did not register in the capture script on the first pass; the river was captured separately).
- Load speed: the demo server needed 15 to 100 seconds per data call under parallel load, and about 15 to 20 seconds one at a time. That is a dev server on a remote database, not a measure of production, so it is not ranked.

## Also seen

- The Unanswered list (list-1440-dark) is dense and clear, but the "Flags" column is empty on every row in the demo, and the Reply button only shows on the hovered row (a phone has no hover).
- unanswered-in-speed "dense list" test reported a first row of 57px against a 44px limit on the demo server; the screenshot shows 40px rows, so that check needs a re-run on a quiet server before it is trusted either way.
