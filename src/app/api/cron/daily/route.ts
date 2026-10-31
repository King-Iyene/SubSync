import { NextResponse } from "next/server";
import { safeError } from "@/lib/safe-log";
import { maintenanceOn } from "@/lib/runtime-guards";
import { buildDailyDigest } from "@/lib/analytics/digest-service";
import { digestText, dueNow, localParts } from "@/lib/analytics/digest-intel";
import { sql } from "@/lib/db";
import { postToSlack } from "@/lib/notify";

// Runs every hour. For each agency that switched the daily brief on and set a Slack webhook, it
// sends the brief once a day, at the hour and in the time zone the agency chose (default 8:00 in
// the time zone of its first client account, or UTC). A run that is late, or a day that was
// missed, still sends the same day; a day is never sent twice.
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (maintenanceOn(process.env)) return NextResponse.json({ skipped: "maintenance" });
  const now = new Date();
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/+$/, "");
  try {
    const rows = await sql()`
      select i.id, coalesce(i.company_name, 'your agency') label, s.slack_webhook_url, s.digest_hour, s.digest_timezone, s.last_daily_digest_on::text last_on,
        (select l.timezone from locations l where l.installation_id = i.id and l.timezone is not null order by l.name limit 1) first_zone
      from installations i join settings s on s.installation_id = i.id
      where i.uninstalled_at is null and not i.is_demo and i.mode = 'agency' and s.digest_enabled and s.slack_webhook_url is not null`;
    let sent = 0;
    for (const r of rows) {
      const zone = (r.digest_timezone as string | null) ?? (r.first_zone as string | null) ?? "UTC";
      const hour = (r.digest_hour as number | null) ?? 8;
      if (!dueNow(now, zone, hour, r.last_on as string | null)) continue;
      try {
        const d = await buildDailyDigest(r.id as string);
        const text = digestText(r.label as string, { attention: d.attention, fine: d.fine.length, headlines: d.headlines, freshnessLabel: d.freshness.label }, appUrl);
        if (await postToSlack(r.slack_webhook_url as string, text)) {
          const today = localParts(now, zone)?.date;
          if (today) await sql()`update settings set last_daily_digest_on = ${today}::date where installation_id = ${r.id}`;
          sent++;
        }
      } catch (error) {
        console.error("Daily brief failed for one company", safeError(error));
      }
    }
    return NextResponse.json({ agencies: rows.length, sent });
  } catch (error) {
    console.error("Cron daily failed", safeError(error));
    return NextResponse.json({ error: "Daily brief failed" }, { status: 500 });
  }
}
