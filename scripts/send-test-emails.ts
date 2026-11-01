// Sends two real test emails through the app's own senders to the address you give: the weekly brief and one alert, both clearly marked
// as tests and built with the real templates, unsubscribe link and headers. Nothing is stored. It refuses to run without an address, and
// it never sends to anyone but the address given on the command line.
//   node --env-file=.env.local --import tsx scripts/send-test-emails.ts you@example.com
import { emailConfigured, sendEmail, unsubscribeHeaders } from "../src/lib/email";
import { alertEmail, validEmail, weeklyEmail } from "../src/lib/analytics/weekly-email";
import { unsubscribeUrl } from "../src/lib/unsubscribe";

async function main() {
  const to = process.argv[2];
  if (!to || !validEmail(to)) { console.error("Give one email address: send-test-emails.ts you@example.com"); process.exit(1); }
  if (!emailConfigured()) { console.error("RESEND_API_KEY and EMAIL_FROM are not both set, so nothing can be sent."); process.exit(1); }
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "https://subsync.kdsquares.com").replace(/\/+$/, "");
  // A made-up installation id: the test link opens the confirmation page but cannot change anything for a real company.
  const stop = unsubscribeUrl(appUrl, "00000000-0000-0000-0000-000000000000", to);
  const weekly = weeklyEmail({
    who: "TEST: SubSync weekly brief", appUrl, stopUrl: stop, fine: 9,
    headlines: [{ label: "Open pipeline", money: true, today: 184_000, vsAvg: 4 }, { label: "Waiting for a reply", money: false, today: 6, vsAvg: -20 }],
    attention: [{ name: "Sample account one", title: "4 new leads have waited more than 15 minutes for a reply" }, { name: "Sample account two", title: "12 past appointments have no outcome recorded" }],
    facts: ["9 of 14 new leads (last 14 days) were answered by a person inside 15 minutes (64%)."],
  });
  const alert = alertEmail("TEST: SubSync alert", [{ severity: "critical", title: "Sample account one: 9 new leads have waited more than 15 minutes for a reply" }, { severity: "warning", title: "Sample account two: 12 past appointments have no outcome recorded, so the show rate is a guess" }], appUrl, stop);
  const a = await sendEmail(to, { ...weekly, subject: `[TEST] ${weekly.subject}`, headers: unsubscribeHeaders(stop) });
  const b = await sendEmail(to, { ...alert, subject: `[TEST] ${alert.subject}`, headers: unsubscribeHeaders(stop) });
  console.log(`Weekly brief to ${to}: ${a ? "accepted by the mail provider" : "NOT sent"}`);
  console.log(`Alert to ${to}: ${b ? "accepted by the mail provider" : "NOT sent"}`);
}
void main();
