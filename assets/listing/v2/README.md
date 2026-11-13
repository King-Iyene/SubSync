# Listing images v2 (1600x900 PNG, dark theme, under 500 kB each)

Taken from the demo company with screenshot mode (`?shots=1`, demo only), one identity (Brightpath Growth, Amara Okafor), one run. 01 is the hero; 01 to 10 are the portal picks, 11 and 12 are the pipeline funnel and river, `extra/` holds spares. `shots-report.json` lists every file with pixel size and kB; `scripts/listing-shots.json` lists each file's purpose.

Regenerate: `npm run build`, `npm run demo:fill`, `npm run demo:server -- 3290`, then `BASE=http://localhost:3290 npm run shots` (`npm run shots -- 01,11` re-takes only those; `SHOTS_PARALLEL=1` for one at a time).

The script rejects (writes no file) any screen that still shows an error, loader, demo or sample wording, or a vendor word, after 3 tries.
