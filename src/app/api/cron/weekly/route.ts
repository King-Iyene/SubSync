import { NextResponse } from "next/server";
import { safeError } from "@/lib/safe-log";
import { maintenanceOn } from "@/lib/runtime-guards";
import { buildDailyDigest } from "@/lib/analytics/digest-service";
import { weekFacts, weeklyDue, weeklyEmail } from "@/lib/analytics/weekly-email";
import { localClock } from "@/lib/analytics/digest-intel";
import { appointmentView } from "@/lib/analytics/appointment-queries";
import { getSettings } from "@/lib/analytics/queries";
import { speedView } from "@/lib/analytics/speed-queries";
import { sql } from "@/lib/db";
import { emailConfigured, sendEmail, unsubscribeHeaders } from "@/lib/email";
import { unsubscribeUrl } from "@/lib/unsubscribe";

// Runs every hour. Sends the weekly email to each agency that set an address, on Monday at the hour it chose
// in its own time zone, once a week. Does nothing until an email service key is set.
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (maintenanceOn(process.env)) return NextResponse.json({ skipped: "maintenance" });
  if (!emailConfigured()) return NextResponse.json({ sent: 0, reason: "email service not configured" });
  const now = new Date();
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/+$/, "");
  try {
    const rows = await sql()`
      select i.id, coalesce(s.brand_name, i.company_name, 'Your company') label, s.digest_email, s.digest_hour, s.digest_timezone, s.last_weekly_digest_on::text last_on,
        (select l.timezone from locations l where l.installation_id = i.id and l.timezone is not null order by l.name limit 1) first_zone
      from installations i join settings s on s.installation_id = i.id
      where i.uninstalled_at is null and not i.is_demo and s.digest_email is not null`;
    let sent = 0;
    for (const r of rows) {
      const when = localClock(now, (r.digest_timezone as string | null) ?? (r.first_zone as string | null) ?? "UTC");
      if (!weeklyDue(when, (r.digest_hour as number | null) ?? 8, r.last_on as string | null)) continue;
      try {
        const d = await buildDailyDigest(r.id as string);
        // The week's facts. If any of these reads fails, the email still goes out without that part.
        const target = (await getSettings(r.id as string).catch(() => null))?.speedTargetMinutes ?? 15;
        const [sp, ap] = await Promise.all([speedView(r.id as string, null, target).catch(() => null), appointmentView(r.id as string, null).catch(() => null)]);
        const facts = weekFacts({
          leads: sp ? sp.overall.leads : 0, withinTarget: sp ? sp.overall.withinTarget : 0, targetMinutes: target, neverAnswered: sp ? sp.neverAnswered : 0,
          noShowsToRecover: ap ? ap.recoverTotal : null, unmarked: ap ? ap.unmarkedTotal : null,
        });
        const stop = unsubscribeUrl(appUrl, r.id as string, r.digest_email as string);
        const mail = weeklyEmail({
          facts, who: r.label as string, appUrl, stopUrl: stop, fine: d.fine.length,
          headlines: d.headlines.map((h) => ({ label: h.label, money: h.money, today: h.change.today, vsAvg: h.change.vsAvg })),
          attention: d.attention.map((a) => ({ name: a.name, title: a.items[0]?.title ?? "Needs a look" })),
        });
        if (await sendEmail(r.digest_email as string, { ...mail, headers: unsubscribeHeaders(stop) }) && when) {
          await sql()`update settings set last_weekly_digest_on = ${when.date}::date where installation_id = ${r.id}`;
          sent++;
        }
      } catch (error) {
        console.error("Weekly email failed for one company", safeError(error));
      }
    }
    return NextResponse.json({ agencies: rows.length, sent });
  } catch (error) {
    console.error("Cron weekly failed", safeError(error));
    return NextResponse.json({ error: "Weekly email failed" }, { status: 500 });
  }
}
