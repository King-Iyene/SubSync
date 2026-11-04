# Duplicate contacts: the money test, and a review of the old screen (5 Nov 2026)

King's words: "that duplicate merge, it's fucking useless the current one so need to fix; make merging EASY, and if a feature is missing you add it; make it sexy and lovable, not overwhelming; it must work for agencies AND for client-account users (and on a phone)."

## Part 1. The money-first test (in plain words)

**1. The pain it removes.** Two records for one person cost real money and trust:
- Staff text or call the same person twice (once from each record), or one person is told two different things. The customer notices.
- The history is split: the conversation sits on one record, the deal on the other, the appointment on a third. Nobody sees the whole person.
- Lead counts and "speed to lead" are inflated: a new lead that came in twice is counted twice, so the numbers the agency shows its client are wrong.
- It embarrasses the client: they open their own list and see "Ada Lovelace" twice.
- The dangerous one: a person who asked not to be contacted (Do Not Disturb) can be marked on one copy only, and the other copy gets the message.

**2. Who feels it.** The **ops person** who cleans up (hours of squinting at two screens). The **setter** who calls the wrong copy. The **business owner** who sees the mess in their own list. The **agency owner** whose reports are inflated across every client, and who has no way to see which of 40 or 100 clients has the worst problem.

**3. The number and action that prove it in five seconds.** The first thing on the screen is: **"64 duplicate groups to fix. 72 extra contacts to remove, about 2% of your list. About 3 clicks each."** (the demo company; a real agency sees its own). Below it, the first group is already open with the best record picked and one button: **Merge these 2 contacts**. The three clicks are: Merge, Open both in your CRM, I merged them.

**4. Why would they pay for this rather than use the CRM's own tool or a cheaper one? (said honestly).**
The CRM already has a duplicate tool and a merge: Contacts, the three-dot menu, Manage Duplicates (scans one client account by email, phone or name, shows the records side by side, lets you reject or merge, up to 10 at once, and there is a workflow action "Merge Contact" and an "Allow Duplicate Contacts" switch per account). Only an administrator can use it. What it does not do (read in its help article and its API description, `docs/features/DUPLICATES.md` section 1):
- It works **one client account at a time**. An agency with 40 clients has no single list, no "which client is worst", no ranking by money at risk.
- It does not rank by what matters (open deals, a paying customer, recent activity) and the article says nothing about warning before merging a Do Not Disturb contact.
- It gives no health number ("about 2% of your list") to show a client or to prove a clean-up.
- **SubSync cannot merge for you.** The platform's public API has no merge call, and a merge built from the calls that exist would destroy conversations and deals. So SubSync's honest job is: find them across every client, rank them, pre-pick the record to keep, warn about the traps, open the right two contacts in your CRM and let you tick it off.

Honest verdict: **on its own this is not a reason to pay**, and I would not sell it alone. It is worth keeping as a small, free-tier "data health" module because it (a) feeds the Instant Audit ("N duplicates are inflating your lead count"), (b) makes the agency's numbers trustworthy, (c) gives a client's own staff a calm way to fix their list, and (d) costs nothing to run. The same screen is the shop window for the paid features around it (speed to lead, unanswered messages). If King wants it to carry weight on its own, the one thing that would change that is a real merge call from the platform: then the three clicks become one.

**5. What to cut.** Already cut in the rebuild: the confidence-range bulk tool (a dropdown of "90 to 100") and the "Save this record to keep" button that saved a choice nobody could use; the table-per-group wall; the card that listed every account's duplicate-protection setting (now one line, only for accounts that allow duplicates); name-only groups (noise); percentages ("94% sure") as the main signal. Not built on purpose: bulk merging from SubSync (preview only), matching by name and company (the company name is not copied into SubSync).

## Part 2. The old screen, reviewed

Reviewed on the demo company with real screenshots at 1440, 768 and 390 for the four roles (agency all accounts, agency inside one account `?as=location`, a client's staff `?as=client`, a business owner `?as=business`): `docs/review/duplicates-old-<role>-<width>.png`. The new screen is photographed the same way: `docs/review/duplicates-<role>-<width>.png` and `duplicates-merge-sheet-<width>.png`.

**What is useless about it (each point seen on the screenshots or in the code):**

1. **There is no merge.** The page opens by saying SubSync "never changes your contacts". The buttons are "I merged these in the platform", "Save this record to keep" (a choice that is saved and then used by nothing) and "Not duplicates". A person who came to merge is told to go and do it somewhere else, with no help on where or how.
2. **The first screen is not the work.** Three tiles (Exact matches 48, Written differently 16, Contacts involved 136) count kinds of match, not what the person wants to know; then a card "Is duplicate protection on?" with **13 rows, one per client account, every one saying "Setting not shown by the platform"**. At 100 clients that card is 100 useless rows above the first duplicate. A client's staff see it too, for their one account.
3. **Numbers that disagree.** The tiles say 48 + 16 = 64 groups; the list says "60 names, 60 groups" because the server silently cut the list at 60 (`slice(0, 60)`) and the candidate read at 8,000 contacts. A big account or agency would be wrong without a word.
4. **One row per name, not per problem.** The list is grouped by name per account, 20 a page, and every row says "99% sure" in red. Nothing says why (same phone? same email?), what is at stake (open deals, a customer, a Do Not Disturb contact), or which to do first. Percentages and a red status dot-and-pill style on every row are the "AI-looking" badges King rejected (KF-1).
5. **The review itself is a wall.** Opening a row prints a comparison table of eight fields (name, email, phone, tags, added, last activity, deals, conversation) whether or not they differ, then a box "After merging, the kept record should have..." and a paragraph of instructions. The reader has to find the differences by eye.
6. **The bulk tool is a dropdown of "confidence 90 to 100 (exact)" and "Below 75 (weak hints)"** that can only record a decision; it merges nothing, and "Accept the recommended record to keep" has no effect on any contact.
7. **No guardrails.** Nothing warns about Do Not Disturb, a paying customer, open deals on the record that will go, or two different owners. And a chain of matches could present two different people as one group (A and B share an email, B and C a phone).
8. **Nothing to act with.** No call or email button, no tag dates, no owner, no source, no way to say "not now", no keyboard.
9. **It does not work for client-account users.** A client's staff get the same page read-only (`canReview` false): every "Review" opens a table with no way to decide anything.
10. **Phone.** The comparison table has a minimum width of 520 px inside a scroll box, so the page itself does not scroll sideways but the table does; the buttons are small text links.
11. **Words.** "Setting not shown by the platform", "Exact matches", "Written differently", "confidence" are platform and statistics words, not a person's words.

**What the rebuild does about each point:** (1) a guided merge that ends in the CRM's own merge screen with the right contacts open, plus a one-click merge that is built and switched off; (2) the first screen is the headline "64 duplicate groups to fix" with the first group already open, the protection card is one line and only for accounts that allow duplicates; (3) every number comes from the same open list, and the server sends one page and one group, never a silent cut; (4) groups with a plain reason, ranked by what matters, five at a time with "See all"; (5) only what differs, the rest collapsed; (6) the bulk tool is gone, "Merge all the obvious ones" is a preview; (7) four warnings with a deliberate click, and people who clearly differ are never offered; (8) call, email and open buttons through the white-label link helper, tag dates, owner, source, Not a duplicate, Not now, Skip, keyboard; (9) the same screen for a client's staff and a business owner, scoped to their own account on the server; (10) thumb-sized buttons and no sideways scroll at 390 px (tested); (11) plain words, reviewed with the UX copy skill.
