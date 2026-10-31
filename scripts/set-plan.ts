import { closeDb, sql } from "../src/lib/db";

// Maps a marketplace plan id to a tier. A plan swap is this one command, never a deploy.
//   node --env-file=.env.local --import tsx scripts/set-plan.ts <planId> <free|pro> [note]
//   node --env-file=.env.local --import tsx scripts/set-plan.ts --list
async function main() {
  const [a, b, ...note] = process.argv.slice(2);
  if (a === "--list") {
    for (const r of await sql()`select plan_id, tier, note from plan_entitlements order by plan_id`) console.log(`${r.plan_id}  ${r.tier}  ${r.note ?? ""}`);
    return;
  }
  if (!a || (b !== "free" && b !== "pro")) {
    console.error("Usage: set-plan.ts <planId> <free|pro> [note]   or   set-plan.ts --list");
    process.exitCode = 1;
    return;
  }
  await sql()`insert into plan_entitlements (plan_id, tier, note) values (${a}, ${b}, ${note.join(" ") || null})
    on conflict (plan_id) do update set tier = excluded.tier, note = excluded.note, updated_at = now()`;
  console.log(`Plan ${a} now gives the ${b} tier.`);
}

main().finally(() => closeDb());
