# Listing images v2 (1600x900 PNG, dark theme, under 500 kB each)

Status: the capture script and screenshot mode are in place, but the images themselves have NOT been generated yet. The machine that built this change could not reach the database (the direct database host is IPv6 only and timed out), so the demo could not be filled or served.

Generate them on a machine that can reach the database:

1. `npm run build`
2. `npm run demo:fill` (demo company `demo-agency` only), then `npm run demo:server` (http://localhost:3210)
3. `npm run shots` (writes 01 to 11 here and the rest to `extra/`; `npm run shots -- 01,03` re-takes only those)

Screenshot mode: `?shots=1` on the app address (the script adds it). It works only when the demo sign-in is on, which is refused in production. It hides the demo banner and the live/sample badge, and shows the agency name as "Brightpath Growth". Data is not changed. The script warns when a vendor word or a demo/sample label is still on screen, and when a tab name in `scripts/listing-shots.json` is not found.

Shot list and purpose: see `scripts/listing-shots.json` (01 is the hero; the top 10 are the portal picks, `extra/` holds the rest). The script writes `shots-report.json` with each file's pixel size and kB.
