import { sql } from "../db";
import { realTransports } from "../notifications/transports";
import { unsubscribeUrl } from "../unsubscribe";
import { linkText, wordsLink } from "../notifications/crm-links";
import { getSettings } from "./queries";
import { emailDue, emailText, validZone } from "./today3-intel";
import { today } from "./today3-queries";

// The daily Today email: the same ranked list as the screen, one link, one message per person at the chosen hour of the business's own day. It goes only to the people you chose.
// It goes through the one outward gate (realTransports, then the SEND_EMAIL_LIVE switch): with the switch off it writes a "WOULD SEND" audit line and sends nothing.
const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Safe to call every hour or late: the day key is claimed first, so a second run in the same day sends nothing. */
export async function runTodayEmail(inst: string, now = Date.now()): Promise<number> {
  const [p] = await sql()`select email_on, email_hour, quiet_days, recipients, last_sent_key from td_prefs where installation_id = ${inst}`.catch(() => []);
  if (!p || p.email_on !== true || !((p.recipients as string[] | null) ?? []).length) return 0;
  const [st] = await sql()`select digest_timezone from settings where installation_id = ${inst}`.catch(() => []);
  const [lz] = await sql()`select timezone from locations where installation_id = ${inst} and coalesce(timezone, '') <> '' order by name limit 1`.catch(() => []);
  const tz = validZone((st?.digest_timezone as string | null) ?? (lz?.timezone as string | null) ?? "UTC");
  const { due, key } = emailDue(now, tz, Number(p.email_hour), ((p.quiet_days as number[] | null) ?? []).map(Number), (p.last_sent_key as string | null) ?? null);
  if (!due) return 0;
  const claimed = await sql()`update td_prefs set last_sent_key = ${key} where installation_id = ${inst} and last_sent_key is not distinct from ${(p.last_sent_key as string | null) ?? null} returning 1`;
  if (!claimed.length) return 0;
  const board = await today({ inst, allowed: null, level: "all", selfId: null }, null, now);
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/+$/, "");
  const crmDomain = (await getSettings(inst)).appDomain; // the company's own CRM domain: the email opens the CRM, never SubSync
  let sent = 0;
  for (const to of p.recipients as string[]) {
    const stop = unsubscribeUrl(appUrl, inst, to);
    const m = emailText(board, linkText(wordsLink(crmDomain, "SubSync > Today")), stop);
    const mailer = realTransports(inst, () => stop);
    await mailer.email(to, { subject: m.subject, text: m.text, html: `<p>${esc(m.text).replace(/\n\n/g, "</p><p>").replace(/\n/g, "<br>")}</p>` }, []);
    sent++;
  }
  return sent;
}
