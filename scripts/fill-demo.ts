import { closeDb } from "../src/lib/db";
import { makeDemoReady, DEMO_COMPANY_ID } from "../src/lib/demo/seed";
import { wipeDemo } from "../src/lib/demo/fill-core";

// Usage: node --env-file=.env.local --import tsx scripts/fill-demo.ts [--fresh]
// Makes the demo ready and fills every module (idempotent: a second run changes nothing). --fresh first removes the whole demo company and makes it again from nothing (a few minutes more).
async function main() {
  const started = Date.now();
  if (process.argv.includes("--fresh")) await wipeDemo(DEMO_COMPANY_ID);
  await makeDemoReady({ wait: true });
  console.log(`Demo is ready and filled (${Math.round((Date.now() - started) / 1000)} s)`);
  await closeDb();
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
