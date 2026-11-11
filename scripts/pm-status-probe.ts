// Prints, from what the Payments sweep has stored, the distinct status words the platform sent for payments, repeat payments, invoices and paid plans, how often each appeared,
// and whether amounts look like whole units or cents (CHECK 2 and 4 in docs/research/PAYMENTS_R1.md). Read only. Run against a real agency after the first sweep:
//   node --import tsx scripts/pm-status-probe.ts [installation id]
// Output (counts and words only, never a name or an email) goes to King.
import postgres from "postgres";

const url = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
if (!url) { console.error("Set DATABASE_URL."); process.exit(2); }
const db = postgres(url.split("?")[0], { prepare: false, max: 1, ssl: process.env.MIGRATE_SSL === "off" ? false : "require", onnotice: () => {} });
const inst = process.argv[2] ?? null;
try {
  const words = await db`select kind, coalesce(status_raw, '(none)') status, status_mapped, count(*)::int n from pm_items where ${inst ? db`installation_id = ${inst}` : db`true`} group by 1, 2, 3 order by 1, 4 desc`;
  console.log("Status words (kind, word, how we read it, rows):");
  for (const w of words) console.log(` ${w.kind}  ${w.status}  ->  ${w.status_mapped}  x${w.n}`);
  const amounts = await db`select kind, currency, min(amount) lo, max(amount) hi, count(*) filter (where amount = round(amount))::int whole, count(*)::int n from pm_items where amount is not null and ${inst ? db`installation_id = ${inst}` : db`true`} group by 1, 2 order by 1, 2`;
  console.log("\nAmounts (kind, currency, smallest, largest, rows that are whole numbers of all rows). If every amount is whole and large (for example 4900 for a $49 plan) the platform sends cents:");
  for (const a of amounts) console.log(` ${a.kind}  ${a.currency ?? "(none)"}  ${a.lo}..${a.hi}  ${a.whole}/${a.n}`);
  const live = await db`select live_mode, count(*)::int n from pm_items where ${inst ? db`installation_id = ${inst}` : db`true`} group by 1`;
  console.log("\nLive and test rows:", live.map((l) => `${l.live_mode ? "live" : "test"} ${l.n}`).join(", "));
} finally { await db.end(); }
