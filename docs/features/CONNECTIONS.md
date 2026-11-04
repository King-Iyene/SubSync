# Connections moved into Settings, Integrations (4 Nov 2026)

Status: **BUILT on branch `stage/conn`, awaiting King's checks.** No migration, no new table, no API change. Review and spec: `docs/CONNECTIONS_REVIEW.md`. Decision: `docs/DECISIONS.md`, "Connections moved into Settings, Integrations".

## What changed, in plain words

- **"Connections" is gone from the menu.** The foot of the sidebar is now Settings, Getting started, What's new.
- **Settings, Integrations holds the connections.** One click on Settings, one on Integrations. Top to bottom: My connections (each person's own Fathom), Team connections (administrators only: who has connected, Slack for the team, the rules), then What SubSync can read. The screens, buttons and words are the same as before; their headings sit one level lower, under Integrations. The pointer card "Open Connections in the menu" is gone.
- **Old addresses keep working.** `#connections`, the Meeting notes inbox link, and any saved link open Settings on Integrations; the address becomes `#settings`; Settings stays highlighted in the menu. The Getting started steps never pointed at Connections (checked: every step target is a real page, tested).
- **A client's staff keep one entry, "Integrations".** They have no Settings (the Settings API stays closed to them), but they connect their own tools. Their entry opens a page with My connections and, for the account's administrator, the team part for their own account only; no permissions list.
- **One name.** The Meeting notes inbox now says "Open Integrations"; the Notifications text already said Integrations.
- **Nothing a connection does changed.** No change to sending, billing, scopes, environment variables, the live switches, or any API path or table.

## Who sees what (every role)

| Role (demo address) | Menu | Integrations shows | Access rule (unchanged) |
|---|---|---|---|
| Agency, all accounts (`/app`) | Settings | My connections, Team connections (admin), What SubSync can read | route policy: agency full |
| Agency person inside one account (`?as=location`) | Settings | same as the agency | same |
| Business owner (`?as=business`) | Settings | My connections, Team connections for their own account if they are the administrator, What SubSync can read | `my-connections` and `team-connections` open, the handler decides admin |
| Client's staff (`?as=client`; the demo user is the account's administrator) | Integrations (no Settings) | My connections; Team connections for their own account only if they are the administrator (rules say "for this account"); never the permissions list | `settings` still refused; `my-connections` open; `team-connections` returns 403 for an account user so the section is not drawn |

## Files

- `src/app/app/nav.ts`: the Connections entry is a child of Settings (not in the menu); `showWhenParentHidden`; `visibleNav()` (pure); `PARENT.connections = "settings"`.
- `src/app/app/dashboard.tsx`: menu from `visibleNav`; an old address opens Settings on its section (`movedTo`, `viewId`); the address is rewritten once signed in; the client's Integrations page.
- `src/app/app/views/connections.tsx`: `IntegrationsContent` (the screens) and `IntegrationsPage` (the client's page); `level` passed to the sections.
- `src/app/app/views/settings-slot-connections.tsx`: draws the connection screens at the top of Integrations. `settings.tsx`: the `openSection` prop, the pointer card removed.
- `src/app/app/ds/template.tsx`: `Section` takes an optional `level` (2 or 3) so a block inside another section uses an h3.
- `src/lib/settings-sections.ts`: `MOVED_INTO_SETTINGS`, `movedSettingsSection()`; the Integrations hint rewritten.
- `src/app/app/views/meeting-inbox.tsx`: "Open Integrations".
- Tests: `tests/unit/connections-in-settings.test.ts` (new), `src/lib/__tests__/settings-sections.test.ts`, `tests/unit/ds-components.test.ts`, `tests/e2e/connections-in-settings.spec.ts` (new), and the older specs that opened the Connections page (`menu`, `e0-connections`, `e2a-fathom`, `s02b`, `f8`).

## Design skills run and what each changed

Run on the finished screens (`docs/review/connections-<role>-<width>.png`, four roles, 1440, 768, 390). What each changed:

- **Design critique.** At 768 px the Settings page put the app menu, a 13.5 rem section list and the content side by side, so the connection row was squeezed into a column about 190 px wide (the text wrapped one word a line). The two-column layout now starts at 1024 px; at 768 the sections are the same swipe strip as on a phone and the content has the full width. The Team connections block said the same thing twice ("Nobody has connected a tool yet" and, under it, "Nobody has connected yet. Ask each person..."); the second sentence is gone. The page said "Pick a section on the left" although on a phone the list is on top: now "Pick a section." What works and was left alone: one primary button per row (Connect), status as plain words, headings in order (Settings, Integrations, My connections).
- **Accessibility review.** Touch targets: every button in My connections and Team connections, the Settings section tabs, and the close button of the tip are 44 px on a phone (the shared button is 32 px, so a phone-only minimum height is set on these two sections; tested). Heading order is h1 Settings, h2 Integrations, h3 My connections, h3 Team connections (the shared Section got a `level` option for this). The current section is marked `aria-current`. Status is a word, never colour alone. Not changed: the 12 px grey explanatory lines (existing style across the app) and the Settings section strip not scrolling the chosen tab into view when it is a later section.
- **UX copy.** One name, Integrations, in the Settings hint, the menu entry for a client's staff, the Meeting notes inbox ("Open Integrations") and the empty team state. The section hint now says what the person can do: "Connect your own tools once, see who on your team has connected, and what SubSync may read."
- **Dataviz:** not applicable (no chart on these screens).

## Customer-eyes improvements (KF-5)

| What | Persona | Where |
|---|---|---|
| The setup place is where people look first: Settings, with one section called Integrations; the same name in every sentence that points to it | P1 skeptical agency owner, P4 local business owner | Menu, Notifications text, Meeting notes inbox |
| A shorter foot of the menu (three entries instead of four) | P3 setter | Sidebar |
| A client's staff are not told about Settings they cannot open; their one entry says what it is | P3 setter | Menu (client) |
| The old link a customer saved or was emailed still works | P2 ops person | `#connections` |

Proposals (not built): a "Connect Fathom" and "Connect Slack" step in Getting started that opens Integrations directly (today only the optional Meeting notes step exists, and only when that page is on); one place to connect Slack (it can be connected from Team connections and, separately, from Notifications, which are two screens for one fact).

## King's 5 checks (plain words)

1. Look at the left menu as the agency owner. There is no "Connections". At the bottom: Settings, Getting started, What's new.
2. Press Settings, then Integrations in the list on the left. At the top you see My connections (Fathom, with its Connect button) and, as an administrator, Team connections (who has connected, Slack, the rules), then "What SubSync can read".
3. Type `/app#connections` in the address bar (a saved link). You land on Settings with Integrations open, and the address changes to `#settings`.
4. Open the demo as a client's staff user (add `?as=client`). The menu has no Settings but one entry, Integrations. It shows "My connections" (the demo user is the account's administrator, so the team part for their own account also shows; an account user would not get it) and no permissions list.
5. Make the window a phone width (390 px). Settings, Integrations has no sideways scroll, the Connect button is easy to press with a thumb, and the section list scrolls inside its own strip.

## Tests and results (4 Nov 2026, demo company, one slow machine, own server on port 3111)

- `npx next typegen && npx tsc --noEmit`: 0 errors. `npx eslint src tests`: 0 errors, 11 warnings (older).
- `node --test src/lib/__tests__/`: tests 839, pass 839, fail 0.
- `npx vitest run --no-file-parallelism` on the files this stage touches or that read the menu and access rules (`connections-in-settings`, `ds-components`, `client-access`, `c1-access`, `e0-tenancy-and-secrets`, `flags-default-off`): 6 files, 73 tests, all pass. The full vitest suite and the database-backed tests were NOT run.
- Browser: `connections-in-settings.spec.ts` at 1440, 768 and 390: 26 passed (4 roles; menu, old address, one click from the menu, phone thumb targets, typing the old address into an open page). Desktop 1440: `menu` 1, `e0-connections` 6, `e2a-fathom` 4, `s02b` 11, `f8` (the Data and privacy and Integrations test, after fixing its selector: the first details element is now the Fathom notice) 1, `settings` (the eight sections test) 1. Not passed: `settings.spec.ts` "stale threshold" timed out in an API recalculation on this machine (API only, no screen, the demo setting was checked afterwards and is back at 30/30/4/15); the other settings API tests of that file did not run (serial mode) and were not retried.
- A first-run failure of the old-address test happened twice before the helper loaded the address fresh instead of goto, goto-with-hash, reload (a slow-machine race in the helper, not in the app; the app path was reproduced by hand three times).
- Screenshots: `docs/review/connections-<role>-<width>.png` for agency, agency-account, business and client at 1440, 768 and 390. All twelve were taken before the 1024 px layout change and the two copy edits (empty team state, "Pick a section"), so the 768 shots still show the old squeezed Settings layout; the new layout was verified by the 768 browser run, not re-photographed.

## NOT verified

Everything ran on the demo company. Not verified: a real sign-in from inside a white-label CRM menu (the address rewrite and the Settings highlight use the same code as every other page, but only the demo was driven); a real Fathom or Slack sign-in (the demo cannot start one, unchanged by this stage); how Integrations looks on King's own screen.
