// Reports what is and is not set up for sending email, without sending anything and without printing any secret (names and the sending
// domain only). It also checks the sending domain's SPF, DKIM and DMARC records, which decide whether mail lands in the inbox or in spam.
//   node --env-file=.env.local --import tsx scripts/check-email-setup.ts
import { checkDomain, extractDomain } from "../src/lib/dns/email-auth";

async function main() {
  const names = ["RESEND_API_KEY", "EMAIL_FROM", "CRON_SECRET", "NEXT_PUBLIC_APP_URL", "TOKEN_ENCRYPTION_KEY"];
  for (const n of names) console.log(`${n}: ${process.env[n] ? "set" : "MISSING"}`);
  const from = process.env.EMAIL_FROM ?? "";
  const domain = extractDomain(from);
  console.log(`Sending address: ${from ? from.replace(/^.*</, "<") : "(not set)"}  domain: ${domain ?? "(none)"}`);
  if (!domain) { console.log("Cannot check the sending domain without EMAIL_FROM."); return; }
  // Resend signs mail with its own selector ("resend._domainkey"); the generic list is checked as well.
  const r = await checkDomain(domain, undefined, ["resend", "default", "google", "selector1", "selector2", "k1", "s1", "mail"]);
  console.log(`SPF:   ${r.spf.found ? `found (${r.spf.record ?? ""})`.slice(0, 120) : "MISSING"}`);
  console.log(`DKIM:  ${r.dkim.found ? `found (selector ${r.dkim.selector})` : "NOT FOUND for the common selectors"}`);
  console.log(`DMARC: ${r.dmarc.found ? `found (policy ${r.dmarc.policy ?? "?"})` : "MISSING"}`);
  console.log(`Status: ${r.status}`);
  for (const f of r.findings) console.log(` - [${f.severity}] ${f.area}: ${f.message}${f.fix ? ` Fix: ${f.fix}` : ""}`);
}
void main();
