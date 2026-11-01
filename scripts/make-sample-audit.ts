// Creates (or refreshes) the sample real estate audit that can be shown to a prospect: a fictional four-office team with
// the problems a real estate team really has (Facebook and Instagram lead forms waiting, deals that stopped moving, showings
// nobody marked, no-shows nobody rebooked). Every number is invented and the page says so. It lives under the demo
// installation, never under a real one, and never expires.
//
// Stage F6: the sample is made by the same code a real share link uses (the audit's own fix-first line and definitions, then buildSharePayload), so what a
// prospect sees is exactly the shape of a real report: a fix-first line, counted facts apart from the estimate with its range, a fix plan, a next step and
// how each number is counted.
//   node --env-file=.env.local --import tsx scripts/make-sample-audit.ts
import { closeDb, sql } from "../src/lib/db";
import { DEMO_COMPANY_ID, ensureDemo } from "../src/lib/demo/seed";
import { auditNotes, fixFirstLine, type Finding } from "../src/lib/analytics/audit-intel";
import { buildSharePayload, SAMPLE_AUDIT_ID, type SharePayload } from "../src/lib/analytics/share-intel";

export { SAMPLE_AUDIT_ID };

const NOT_USED = { detail: "", view: "deals" } as const;
const findings: Finding[] = [
  { ...NOT_USED, key: "slow", severity: "critical", title: "27 Facebook and Instagram lead-form leads were still waiting for a first reply after an hour (target: 10 minutes)", count: 27, dollars: null, kind: "fact", view: "inbox", note: "slow", window: "Customer's last message more than 1 hour ago, within the last 30 days", fix: "Have one person own every new lead-form lead for the first hour of each day, and turn on a text that goes out within a minute so no lead waits for a person." },
  { ...NOT_USED, key: "unmarked", severity: "critical", title: "14 showings are in the past with no outcome recorded, so the show rate cannot be trusted", count: 14, dollars: null, kind: "fact", view: "appointments", note: "unmarked", window: "Started more than 3 hours ago, in the last 30 days", fix: "Mark each past showing as held or no-show today, then make it part of the end-of-day routine." },
  { ...NOT_USED, key: "stale", severity: "warning", title: "$412,000 is sitting in 9 deals that have not moved in 30 days", count: 9, dollars: 412_000, kind: "fact", note: "stale", window: "No change for 30 days or more, counted now", fix: "Call or message the owner of each stuck deal this week; close the ones that are dead so the pipeline tells the truth." },
  { ...NOT_USED, key: "slow", severity: "warning", title: "11 leads from Zillow and open house sign-ins were never answered", count: 11, dollars: null, kind: "fact", view: "inbox", note: "slow", window: "Customer's last message more than 1 hour ago, within the last 30 days", fix: "Reply to these now, even late, and set a rule that portal leads are answered by phone within five minutes." },
  { ...NOT_USED, key: "noshows", severity: "warning", title: "6 no-shows from the last 7 days have not been offered a new showing", count: 6, dollars: null, kind: "fact", view: "appointments", note: "noshows", window: "No-shows in the last 14 days with no later booking", fix: "Send each a message offering two new times within a day of the missed showing." },
  { ...NOT_USED, key: "slow", severity: "warning", title: "About $186,000 of pipeline is at risk from slow follow-up", count: null, dollars: 186_000, kind: "estimate", view: "inbox", note: "estimate", fix: "This is the size of the problem, not money lost: fixing the first-reply times above is how it shrinks." },
];

const leftOut = 38;
const payload: SharePayload = buildSharePayload(
  {
    headline: "Sample audit for a four-office real estate team: $412,000 is stuck in deals that stopped moving, and 27 Facebook and Instagram leads waited over an hour.",
    accountsScanned: 4, staleDollars: 412_000, estimatedDollars: 186_000, estimateRange: { low: 131_000, high: 247_000 }, outlier: null, leftOut,
    findings, fixFirst: fixFirstLine({ findings }),
    notes: auditNotes({ findings, leftOut }, { staleDays: 30, slaHours: 1 }),
  },
  "Sample real estate team (fictional data)", [], new Date("2026-10-31T12:00:00.000Z"),
  // Not branded: the sample is shown with the product's own sign-up link, and it names itself as fictional. No counting rules are stamped: nothing in it was counted.
);

async function main() {
  const installationId = await ensureDemo();
  const [demo] = await sql()`select id from installations where company_id = ${DEMO_COMPANY_ID} and is_demo`;
  if (!demo || demo.id !== installationId) throw new Error("The demo installation was not found");
  await sql()`
    insert into shared_audits (id, installation_id, payload, expires_at)
    values (${SAMPLE_AUDIT_ID}, ${installationId}, ${sql().json(payload as never)}, now() + interval '5 years')
    on conflict (id) do update set payload = excluded.payload, expires_at = excluded.expires_at`;
  console.log(`Sample audit ready: /audit/${SAMPLE_AUDIT_ID}`);
  await closeDb();
}
void main();
