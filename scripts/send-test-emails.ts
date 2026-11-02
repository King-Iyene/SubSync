// Sends ONE test email (a sample alert, clearly marked [TEST]) through the same guarded path the "Send me a test" button uses:
//   - while SEND_EMAIL_LIVE is off, a real email goes ONLY to an allowlisted address (src/lib/notifications/test-send.ts, today king@kdsquares.com), at most
//     5 times in 24 hours; any other address is a dry run (a "WOULD SEND" line, nothing sent);
//   - with SEND_EMAIL_LIVE on, it is a normal live send to the address you give.
// Nothing is stored apart from one audit line when a live test is counted. It refuses to run without an address, and sends to nobody else.
//   node --env-file=.env.local --import tsx scripts/send-test-emails.ts king@kdsquares.com
import { closeDb, sql } from "../src/lib/db";
import { validEmail } from "../src/lib/analytics/weekly-email";
import { composeEmail } from "../src/lib/notifications/compose";
import { sendTestMail, testOutcomeText } from "../src/lib/notifications/test-send";
import { testSendDeps } from "../src/lib/notifications/transports";
import { isLive } from "../src/lib/live-flags";
import { unsubscribeUrl } from "../src/lib/unsubscribe";

async function main() {
  const to = process.argv[2];
  if (!to || !validEmail(to)) { console.error("Give one email address: send-test-emails.ts you@example.com"); process.exit(1); }
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "https://subsync.kdsquares.com").replace(/\/+$/, "");
  const [inst] = await sql()`select id from installations where not is_demo and uninstalled_at is null order by created_at limit 1`;
  if (!inst) { console.error("No installation to record the test against."); process.exit(1); }
  // A made-up installation id in the link: it opens the confirmation page but cannot change anything for a real company.
  const stop = (email: string) => unsubscribeUrl(appUrl, "00000000-0000-0000-0000-000000000000", email);
  const mail = composeEmail([{
    title: "Sample Dental: 9 new leads have waited more than 15 minutes for a reply", body: "Open Speed to lead to see who is waiting and call them first.", details: [],
    severity: "warning", link: { view: "speed", locationId: null },
  }], { company: "SubSync", appUrl, stopUrl: stop(to), test: true });
  const out = await sendTestMail(to, [to], mail, testSendDeps(inst.id as string, stop, () => isLive("SEND_EMAIL_LIVE")));
  console.log(`Result for ${to}: ${out.status}${out.status === "refused" ? ` (${out.reason})` : ""}`);
  console.log(testOutcomeText(out, to).text);
  await closeDb();
}
void main();
