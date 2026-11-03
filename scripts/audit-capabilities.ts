// Read-only capability probe (stage F1, docs/CAPABILITIES.md, N64): which data the platform really gives SubSync, and why anything is missing.
// It asks the platform through the app's own token service (only GET requests, one record at a time, at most 70 requests, a pause between each),
// and prints field NAMES, counts and statuses, never a value, a token or customer data. The same check runs inside the app at
// /api/admin/capabilities (server secret only). Locally the production tokens cannot be opened (their key lives only where the app runs), and the
// run then says "NOT VERIFIED LIVE" for that install and still prints what the app has stored.
//   node --env-file=.env.local --import tsx scripts/audit-capabilities.ts [--out result.json]
import { writeFileSync } from "node:fs";
import { closeDb } from "../src/lib/db";
import { collectCapabilities } from "../src/lib/ghl/capabilities-run";

async function main() {
  const out = process.argv.includes("--out") ? process.argv[process.argv.indexOf("--out") + 1] : null;
  const r = await collectCapabilities();
  console.log(`audit-capabilities: ${r.installs.length} real installs, ${r.requests} read-only requests`);
  for (const i of r.installs) {
    console.log(`\n== install: ${i.install}; permissions granted: ${i.scopesGranted.length}${i.note ? "\n   " + i.note : ""}`);
    console.log("   stored conversation types: " + i.storedConversationTypes.join(", "));
    for (const a of i.access) console.log(`   stored access flags, ${a.account}: appointments=${a.appointments} users=${a.users} reply times=${a.speed}`);
    for (const p of i.probes) console.log(`${p.key.padEnd(16)} ${String(p.scope).padEnd(34)} asked=${String(p.requestedByApp).padEnd(5)} granted=${String(p.grantedByThisInstall).padEnd(5)} status=${String(p.status ?? "-").padEnd(4)} ${p.cause}${p.platformTotal !== undefined ? ` total=${p.platformTotal}` : ""}`);
    for (const c of i.counts) console.log(`count check ${c.account}: contacts app=${c.contacts.app} platform=${c.contacts.platform}; deals app=${c.deals.app} platform=${c.deals.platform}; open app=${c.openDeals.app} platform=${c.openDeals.platform}; conversations app=${c.conversations.app} platform=${c.conversations.platform}`);
  }
  if (out) writeFileSync(out, JSON.stringify(r, null, 2));
  await closeDb();
}
void main();
