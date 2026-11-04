# Connections: review and brief (4 Nov 2026)

King's instruction: "Connections" leaves the main menu and becomes a sub-section of Settings (Settings, Integrations). This is the review that sits behind that move, written the same way as `docs/TODAY_REVIEW.md`. Built and recorded in `docs/features/CONNECTIONS.md`. Decision: `docs/DECISIONS.md`, "Connections moved into Settings".

## The money-first test (plain words)

1. **The pain it removes.** A person who opens SubSync for the first time sees sixteen things in the menu. One of them, Connections, is something they do once (sign in to Fathom, connect Slack) and never open again. It sat in the menu every day, next to the pages that make money (Today, Speed to lead, Appointments). It also looked like a daily job, so new customers asked "do I have to keep checking this?". The pain is clutter, and not knowing where to set things up. Moving it into Settings removes the clutter, and putting it in one named place (Settings, Integrations) with one status line per tool makes setup obvious.
2. **Who feels it.** The agency owner or business owner in their first ten minutes (the person who decides whether to keep paying), and every setter and client's staff user who scans the menu each morning for "what do I press". A client's staff have no Settings, so they keep ONE entry, "Integrations", because they connect their own tools too.
3. **The number or action that proves value in five seconds.** There is no money number here and we should not invent one. The proof is an action and a status: "Fathom: Not connected" with one button "Connect", turning into "Connected as Ada, last meeting 2 hours ago, 6 added to contacts". Five seconds: you can see which tools are on and press the one button.
4. **Why they would pay instead of the CRM's own reports.** Honestly: they do not pay for this screen. It is plumbing. What they pay for is what the plumbing carries: a recorded call's summary and action items landing on the contact without anyone retyping it, and an alert that reaches a person in Slack when a lead has waited too long. The CRM's own reports do not push anything to Slack across several client accounts. So this module's job is to make that connection take one minute, once, and then disappear from view.
5. **What to cut.** The menu entry (done). The pointer card inside Settings that said "Open Connections in the menu" (done, the real screens are there now). The second heading level that made "My connections" look like a page of its own (done, headings sit one level under Integrations). Left alone on purpose: Zoom and Google Meet stay hidden behind their switch; the "legacy connections" warning only shows when there is one; the admin rules for transcripts stay, but under Team connections, which only administrators see. Cut later if pilots do not use it: the team table when nobody has connected.

## What a person saw before

1. Connections was a menu entry in the foot of the sidebar beside Settings, Getting started and What's new: four things that are not daily work, one of them a duplicate home for "connect something" (Settings also had a card telling you to open it).
2. Settings, Integrations did not hold the connections. It held a card that said "Open Connections in the menu", and the list of permissions. A person who went to Settings to connect Slack found only a pointer and had to look in the menu.
3. Two pages with different shapes for the same family of things: Settings had sections on the left; Connections was a separate full page with its own title, its own tip, and the heading "Connections".
4. Notification settings said "Connect Slack under Integrations" while the button was on a different page called Connections. The meeting inbox said "Open Connections". Three names for one place.
5. A client's staff saw Connections as one of their few menu items, which is correct (they connect their own Fathom), but it sat among the daily pages.

## What it must be (the spec)

- **No Connections menu entry for an agency or a business.** Settings is the one place. The old address `#connections` (and every link, the sign-in return, the Meeting notes inbox link) opens Settings on Integrations and the address becomes `#settings`.
- **Settings, Integrations is one click from Settings** and shows, top to bottom: My connections (each person's own tools), Team connections (administrators only: who has connected, Slack, the rules), then What SubSync can read (permissions). Same screens, same buttons, same words, one heading level lower.
- **A client's staff keep one menu entry, "Integrations"**, which shows their own connections, and for the account's administrator the team part for their own account only (never Settings, never the permissions list). No new access: the server's route rules are unchanged and a test proves it.
- **One name everywhere.** "Integrations" in the menu (client), the Settings section, the Notifications text, the Meeting notes inbox and the empty states.
- **Phone, 390 px:** Settings shows its sections as a row you can swipe inside its own strip; Integrations is usable with a thumb (buttons 36 px or taller) and the page itself never scrolls sideways.
- **Nothing changes in what a connection does**: no change to sending, billing, scopes, environment variables, or the live switches (`SEND_EMAIL_LIVE`, `SEND_SLACK_LIVE`, `WRITE_GHL_LIVE`, `FATHOM_WEBHOOK_LIVE` stay as they are).

## The other menu items (King's current menu), judged on the same test

King's menu today: Today; Daily work: Speed to lead, Appointments, Unanswered messages, Account audit; Clients and people: Clients, People; More: Overview (My account), Team, Pipeline and deals, Duplicates, Data cleanup, Meeting notes; then Settings, Getting started, What's new.

After this change the foot of the sidebar is Settings, Getting started, What's new: three entries instead of four.

| Item | Verdict | Why |
|---|---|---|
| Today, Speed to lead, Appointments, Unanswered messages, Account audit | Keep | The work that earns the fee. |
| Clients, People | Keep | The agency's and the setter's two nouns. |
| Overview (My account), Team, Pipeline and deals | Keep under More | Useful, not daily; More is the right place. |
| Duplicates, Data cleanup | **Merge into one "Clean-up"** (recommendation below) | Same job (tidy the CRM), both DEFER in CLAUDE.md section 13A, two menu lines for a monthly task. |
| Meeting notes | Stays off until its switch is on | Unchanged. When on, its setup is in Integrations. |
| Getting started, What's new | Keep | Trust builders (CLAUDE.md section 7, Wave 1 item 8). |

### Recommendation: Duplicates and Data cleanup become one "Clean-up" entry (NOT implemented here)

King asked for a review of this, and another agent is rebuilding Duplicates, so nothing in the Duplicates or Data cleanup views was touched by this stage.

- **Do it.** One menu entry "Clean-up" under More with two tabs, "Duplicate contacts" and "Data problems", the same pattern as "Pipeline and deals" (two tabs, one entry) and People. It removes one menu line and makes the pair read as one job.
- **How (small, additive).** Add a menu entry `cleanup` as the module (it already exists as an id) and make `duplicates` a child of it (`parent: "cleanup"`, exactly how `notifications` is a child of `settings` and how `search`, `leads` and `calls` are children of `people`). In the shell, render `ModuleTabs` with two tabs and start on the tab that matches the address (`#duplicates` opens the first tab, `#cleanup` the second). Every old address keeps working. Use `visibleNav` (added in this stage) for the menu logic so a test can prove each role's menu.
- **Flags stay separate.** `duplicates` and `cleanup` are separate feature switches today. A tab is shown only when its own switch is on; the entry is hidden when both are off.
- **Access.** `duplicates` is in every kind's page list; `cleanup` is for the agency and a business only (a client's staff do not have it). So a client's staff would see one tab, "Duplicate contacts", or nothing; the entry must not appear for them with an empty second tab.
- **For the agent rebuilding Duplicates.** Keep exporting `DuplicatesView` with no props and no full-page header of its own when drawn as a tab (the tab strip is the header), or accept a `bare` prop. If it keeps its own `Page` with an h1, the tab page will show two h1s. Do not change the address `#duplicates` or the API paths.
- **When.** After the Duplicates rebuild lands, as its own small stage with a menu test, because this stage and that rebuild both touch `nav.ts` and `dashboard.tsx`.

## Problems found while doing it (and what was done)

| # | Problem | Done |
|---|---|---|
| 1 | Menu item for a one-time job | Removed from the menu; `connections` is now a child of Settings in `nav.ts`. |
| 2 | Settings, Integrations held a pointer, not the screens | The screens (My connections, Team connections) are the top of Integrations; the pointer card is gone. |
| 3 | "Connections" was a full page with its own h1 and a tip | `IntegrationsContent` is the body; inside Settings its headings are level 3 (new optional `level` prop on `Section`). |
| 4 | Old address and links | `#connections` is rewritten to `#settings` and the section opens on Integrations (`MOVED_INTO_SETTINGS` in `settings-sections.ts`, one list, tested). The Meeting notes inbox link now says "Open Integrations". |
| 5 | A client's staff have no Settings | One menu entry "Integrations" for them only (`showWhenParentHidden` in `nav.ts`), the page shows My connections (and, for an administrator of that account, the team part for their own account). Their access rules are untouched: `NAV_FOR.client` still has no `settings`; the Settings API stays closed to them. |
| 6 | The menu logic was one long inline filter | `visibleNav(allowed, { limited, off })` in `nav.ts`, pure and unit tested for all three kinds. |
| 7 | Three names for one place (Connections, Integrations, "Connect Slack under Integrations") | One name, Integrations, in every sentence that points to it. |
| 8 | Slack can be connected from two screens: Team connections (here) and Notifications ("Add to Slack") | NOT changed (different flows, different tables, both live behind the same app registration, out of this stage's scope). Recommended next: one "Connect Slack" in Integrations that Notifications links to. |

## Acceptance

1. The menu has no "Connections" for any role. An agency person, an agency person inside one account and a business owner have Settings; a client's staff have Integrations and no Settings. (`tests/unit/connections-in-settings.test.ts`, `tests/e2e/connections-in-settings.spec.ts`, `tests/e2e/menu.spec.ts`.)
2. `#connections` lands on Settings, Integrations with the section highlighted, the address becomes `#settings`, and the menu keeps Settings highlighted. For a client's staff it lands on the Integrations page.
3. Settings, Integrations shows My connections and, for an administrator, Team connections and What SubSync can read. A client's account user never sees Team connections; a client's administrator sees only their own account's; neither sees the permissions list.
4. Access rules unchanged: the client's route policy still refuses `settings` and the shared Slack sign-in; every kind can still read and change only its own connections (test).
5. At 390 px nothing scrolls sideways; the Connect button is at least 36 px tall.
6. No GoHighLevel, HighLevel or GHL wording on the moved screens (test). Zoom and Google Meet are still hidden (existing tests).
7. Typecheck, eslint, unit tests and the connection, settings and menu browser specs pass; real screenshots at 1440, 768 and 390 for the four roles in `docs/review/connections-*.png`.
