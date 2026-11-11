import { sql } from "../db";
import { realTransports } from "../notifications/transports";
import { unsubscribeUrl } from "../unsubscribe";
import { digestDue, digestEmail, localWeekday, validZone, type DigestDeals } from "./cash-intel";
import { dealsSummary, saveBoard } from "./cash-queries";

// The morning "save this account" digest: ONE email per person per business day, at the chosen hour of the business's own day, outside quiet days and quiet hours.
// It only reads. It never messages a lead. It goes through the one outward gate (realTransports, then the SEND_EMAIL_LIVE switch): with the switch off it writes a "WOULD SEND" line
// and sends nothing (dry run). Muted accounts are left out. Safe to call every hour: the day key is claimed first, so a second run on the same day sends nothing.
/** Returns how many emails were handed to the gate (sent or, with the switch off, written as a dry run). */
export async function runSaveDigest(inst: string, now = Date.now()): Promise<number> {
  const [p] = await sql()`select save_on, save_hour, quiet_days, quiet_from, quiet_to, recipients, last_sent_key from cf_prefs where installation_id = ${inst}`.catch(() => []);
  if (!p || p.save_on !== true || !((p.recipients as string[] | null) ?? []).length) return 0;
  const [st] = await sql()`select digest_timezone from settings where installation_id = ${inst}`.catch(() => []);
  const [lz] = await sql()`select timezone from locations where installation_id = ${inst} and coalesce(timezone, '') <> '' order by name limit 1`.catch(() => []);
  const tz = validZone((st?.digest_timezone as string | null) ?? (lz?.timezone as string | null) ?? "UTC");
  const { due, key } = digestDue(now, tz, Number(p.save_hour), ((p.quiet_days as number[] | null) ?? []).map(Number), p.quiet_from === null ? null : Number(p.quiet_from), p.quiet_to === null ? null : Number(p.quiet_to), (p.last_sent_key as string | null) ?? null);
  if (!due) return 0;
  const claimed = await sql()`update cf_prefs set last_sent_key = ${key} where installation_id = ${inst} and last_sent_key is not distinct from ${(p.last_sent_key as string | null) ?? null} returning 1`;
  if (!claimed.length) return 0;
  const scope = { inst, allowed: null, level: "all" as const, selfId: null };
  const board = await saveBoard(scope, now);
  const monday = localWeekday(now, tz) === 1;
  let deals: DigestDeals = null;
  if (monday) {
    const d = await dealsSummary(scope, null, now);
    deals = { staleCount: d.stale.count, staleValue: d.stale.value, soonCount: d.soon.count, lostNoReason: d.lost.noReason, lostCount: d.lost.count };
  }
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/+$/, "");
  // Nothing at risk and nothing to say on a normal day: no email (one useful digest, not a ping that says nothing).
  if (!board.accounts.length && !(monday && deals && deals.staleCount + deals.soonCount > 0)) return 0;
  let sent = 0;
  for (const to of p.recipients as string[]) {
    const stop = unsubscribeUrl(appUrl, inst, to);
    const m = digestEmail({ scope: `${board.checked} client accounts checked`, accounts: board.accounts, more: board.more, appUrl, stopUrl: stop, deals, monday });
    await realTransports(inst, () => stop).email(to, { subject: m.subject, text: m.text, html: m.html }, []);
    sent++;
  }
  return sent;
}
