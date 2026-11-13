# Demo mode for screenshots and the portal video

The demo is a fictional agency ("Brightpath Growth") with 14 client accounts of different health. Every module has data. It is sample data only: it lives under the company id
`demo-agency`, the demo login is refused in production, and nothing in the demo ever reaches a real CRM or sends a message.

## 1. Start it (about 5 minutes the first time, 30 seconds after)

```
npm run build              # once, and again after you pull new code (about 3 minutes)
npm run demo:fill          # fills every module and moves the demo's dates up to today (see "Fresh dates" below)
npm run demo:server        # serves the production build on http://localhost:3210/app
```

Open **http://localhost:3210/app**. You are signed in as the demo agency owner. A "Demo mode" banner shows at the top (keep it for the video, crop it out of listing images if you like).

- `npm run demo:server` sets `DEMO_MODE=true`, `FLAGS_ALL_ON=true` (every built module is on, including ones still off for real installs) and runs the optimised build with a bigger
  database pool. The demo login is refused whenever `NODE_ENV` is `production`, so the launcher sets `NODE_ENV=development` for that one process; the build itself is the production build.
- A different port: `npm run demo:server -- 3300`.
- The limited views: open `http://localhost:3210/app?as=business` (one business owner), `?as=client` (a client's staff) or `?as=location` (an agency person inside one account). The agency owner view is the default and is the one for the listing images.
- `npm run dev` with `DEMO_MODE=true` also works, but every screen compiles on first open and the remote database makes it slow. Use the production build for screenshots.

### Fresh dates

The demo is built "now" the first time. Whenever it is more than 6 hours old, the next start moves every date and time of the demo company forward by the same amount (so "2 hours ago"
is 2 hours ago again), then rebuilds the stored totals. That takes a few minutes, so run `npm run demo:fill` and wait for "Demo is ready and filled" before you take screenshots in the
morning. A running server does the same in the background if you forget (the first screens may look thin for a few minutes). Dates are shown in Lagos time (Africa/Lagos) for the agency.
Re-running `demo:fill` changes nothing else: every step looks for its own rows first.

### Speed

Screens read stored totals, not a live scan of every row, so most open in 1 to 3 seconds against the remote database (the first sign-in after a start takes 5 to 15 seconds while the demo
is checked). Slower ones, because they still scan live: Today (about 6 s), Speed to lead (about 3 s), Pipeline. If a screen says "Loading" for more than 20 seconds, press Try again.

## 2. Check that every module has data

```
npm run demo:smoke         # opens each module's data endpoint as the demo agency; exits 1 if one is empty or errors
npm run demo:crawl         # opens every module in a real browser, clicks every tab, prints failed calls and "empty" wording
npm run demo:crawl -- today,speed --shots=C:/shots     # also saves a screenshot of every tab
```

## 3. Light and dark, and the three widths

- **Light or dark:** the "Appearance" row at the bottom of the left menu: Auto, Dark, Light. The choice is remembered by the browser.
- **Widths:** DevTools device toolbar (Ctrl+Shift+M): 1280 wide for desktop listing images, 768 for tablet, 390 for phone. Reload after changing the width.
- **Playwright:** `npx playwright test tests/e2e/demo.spec.ts` checks all three widths for horizontal scroll.

## 4. Shot list (best listing images first)

Take each at 1280 wide, light, unless noted. The portal size is 1280 x 800.

| # | Screen (URL hash) | What it should show |
|---|---|---|
| 1 | Today (`#today`) | The money strip (open pipeline, monthly revenue, money you can save today), the "do this first" list, speed and this week. The best hero image. |
| 2 | Speed to lead, Race (`#speed`) | Waiting leads with a clock each, the reply-time bars per client, the leads that breached the target. |
| 3 | Speed to lead, Waiting on the client | Conversations the client has not answered, aged, with the account name. |
| 4 | Appointments (`#appointments`) | The people table with sales and booking share, no-show recovery list, account health. |
| 5 | Clients, Overview (`#clients`) | The grouped tabs, plans and status, who may cancel, needs-attention list. |
| 6 | Clients, Money and plans | Paid up, past due, cancelled, empty credit balances, SubSync missing. |
| 7 | Money (`#payments`) | Failed payments and late invoices with amounts, recovered money, payouts tab. |
| 8 | Pipeline (`#pipeline`) | Valued, owned open deals across the stages, the cash-flow river with dollars, stuck deals. |
| 9 | Clean-up (`#cleanup`) | Duplicate groups in Certain, Likely and Possible, a mixed-name Likely group, a protected group. |
| 10 | Meeting notes (`#meetings`) | Connected Fathom, calls tied to contacts and appointments, calls waiting to be matched, summaries and action items. |
| 11 | Workflows (`#workflows`) | Health per account, campaigns, the call queue workflow marked "set up". |
| 12 | Settings, Integrations (`#settings`) | The AI card connected (a labelled sample) and the 7 am brief wording sample on Today. |

Phone shots (390 wide, one each): Today, Speed to lead, Money.

## 5. What is real and what is invented

- Names, emails (example.com), phone numbers (555), amounts and dates are made up. Account names are fictional.
- Payments, plans, credit balances, calls and the Fathom connection are rows in SubSync's own tables for the demo company. No payment provider, CRM or meeting tool is contacted.
- The AI card shows a connected sample: model "demo-sample-model", a made-up key ending 0000, and one fixed, labelled sample of the 7 am brief wording. No AI provider is ever called in the demo.
- Buttons that would change a real account answer "not available in the demo".

## 6. Known gaps (also see section 7)

See the bottom of `docs/FEATURE_STATUS.md` (section "Demo") for anything still empty.

## 7. Before you take the shots

- **Warm it:** the first open of each screen builds its answers (5 to 25 seconds against the remote database, Find a lead home is the slowest); a second open is instant because the demo server keeps finished answers for 20 minutes. Run `npm run demo:smoke` and `npm run demo:crawl` once first.
- **Tours:** the first visit of Speed to lead and a few other modules opens a "Quick tour". Press Skip once per module (the browser remembers).
- **History start:** "Our own record starts ..." notes on Today show the day the demo was filled (the record is SubSync's own, so it starts then). Charts that use the synced data (leads, deals, appointments, money) have 90 days.
- If a screen says "taking longer than usual", press Try again.
