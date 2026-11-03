// King's admin view of feedback, problem reports, roadmap suggestions and votes, printed in the terminal (read only).
//   node --env-file=.env.local --import tsx scripts/feedback-report.ts
// To "notify voters when it ships" (a dry-run audit line per company that voted, nothing is sent):
//   node --env-file=.env.local --import tsx scripts/feedback-report.ts --shipped <item-key>
import { closeDb } from "../src/lib/db";
import { adminSummary, recordShippedNotices } from "../src/lib/feedback-queries";
import { ROADMAP } from "../src/lib/roadmap";

async function main() {
  const i = process.argv.indexOf("--shipped");
  if (i > 0) {
    const key = process.argv[i + 1];
    const item = ROADMAP.find((r) => r.key === key);
    if (!item) { console.error(`No roadmap item "${key}". Keys: ${ROADMAP.map((r) => r.key).join(", ")}`); process.exitCode = 1; return; }
    if (item.status !== "shipped") console.warn(`Note: "${key}" is not marked shipped in src/lib/roadmap.ts yet.`);
    const plan = await recordShippedNotices(key);
    console.log(`WOULD SEND "it is live" notices for "${key}" to ${plan.length} compan${plan.length === 1 ? "y" : "ies"} (${plan.reduce((n, p) => n + p.voters, 0)} voters). Nothing was sent: one dry-run audit line per company was written.`);
    return;
  }
  const s = await adminSummary();
  console.log(`Votes (${s.votes.length} items)`);
  for (const v of s.votes) console.log(`  ${String(v.votes).padStart(3)} votes from ${v.companies} compan${v.companies === 1 ? "y" : "ies"}  ${v.itemKey}  ${JSON.stringify(v.byKind)}`);
  console.log(`\nSuggestions (${s.suggestions.length})`);
  for (const x of s.suggestions) console.log(`  ${x.ref} ${x.at.slice(0, 10)} [${x.importance}] ${x.title} (${x.role ?? "?"}, company ${x.company}) ${x.details ? "- " + x.details : ""}`);
  console.log(`\nFeedback and problems (${s.feedback.length})`);
  for (const x of s.feedback) console.log(`  ${x.ref} ${x.at.slice(0, 10)} ${x.kind}${x.severity ? "/" + x.severity : ""} on ${x.page ?? "?"} (${x.role ?? "?"}, company ${x.company})${x.errorId ? " error " + x.errorId : ""}: ${x.message}`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => closeDb());
