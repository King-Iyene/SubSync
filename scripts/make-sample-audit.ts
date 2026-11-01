// Creates (or refreshes) the sample real estate audit that can be shown to a prospect: a fictional four-office team with
// the problems a real estate team really has (Facebook and Instagram lead forms waiting, deals that stopped moving, showings
// nobody marked, no-shows nobody rebooked). Every number is invented and the page says so. It lives under the demo
// installation, never under a real one, and never expires.
//   node --env-file=.env.local --import tsx scripts/make-sample-audit.ts
import { closeDb, sql } from "../src/lib/db";
import { DEMO_COMPANY_ID, ensureDemo } from "../src/lib/demo/seed";
import type { SharePayload } from "../src/lib/analytics/share-intel";

export const SAMPLE_AUDIT_ID = "sample-real-estate-team-audit";

const payload: SharePayload = {
  who: "Sample real estate team (fictional data)",
  headline: "Sample audit for a four-office real estate team: $412,000 is stuck in deals that stopped moving, and 27 Facebook and Instagram leads waited over an hour.",
  accountsScanned: 4,
  staleDollars: 412_000,
  estimatedDollars: 186_000,
  findings: [
    { severity: "critical", title: "27 Facebook and Instagram lead-form leads were still waiting for a first reply after an hour (target: 10 minutes)", count: 27, dollars: null, kind: "fact", fix: "Have one person own every new lead-form lead for the first hour of each day, and turn on a text that goes out within a minute so no lead waits for a person." },
    { severity: "critical", title: "14 showings are in the past with no outcome recorded, so the show rate cannot be trusted", count: 14, dollars: null, kind: "fact", fix: "Mark each past showing as held or no-show today, then make it part of the end-of-day routine." },
    { severity: "warning", title: "$412,000 is sitting in 9 deals that have not moved in 30 days", count: 9, dollars: 412_000, kind: "fact", fix: "Call or message the owner of each stuck deal this week; close the ones that are dead so the pipeline tells the truth." },
    { severity: "warning", title: "11 leads from Zillow and open house sign-ins were never answered", count: 11, dollars: null, kind: "fact", fix: "Reply to these now, even late, and set a rule that portal leads are answered by phone within five minutes." },
    { severity: "warning", title: "6 no-shows from the last 7 days have not been offered a new showing", count: 6, dollars: null, kind: "fact", fix: "Send each a message offering two new times within a day of the missed showing." },
    { severity: "warning", title: "About $186,000 of pipeline is at risk from slow follow-up", count: null, dollars: 186_000, kind: "estimate", fix: "This is the size of the problem, not money lost: fixing the first-reply times above is how it shrinks." },
  ],
  createdAt: "2026-10-31T12:00:00.000Z",
};

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
