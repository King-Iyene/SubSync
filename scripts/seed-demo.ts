import { closeDb } from "../src/lib/db";
import { seedDemo } from "../src/lib/demo/seed";

// Usage: node --env-file=.env.local --import tsx scripts/seed-demo.ts
async function main() {
  const started = Date.now();
  const result = await seedDemo();
  console.log(`Seeded demo agency: ${result.accounts} accounts, ${result.contacts} contacts in ${Date.now() - started} ms`);
  await closeDb();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
