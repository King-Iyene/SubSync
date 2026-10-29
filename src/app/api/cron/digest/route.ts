import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { sendDigest } from "@/lib/analytics/service";

// Weekly Slack summary for agencies that switched the digest on and set a webhook.
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const rows = await sql()`
      select i.id, coalesce(i.company_name, 'your agency') label
      from installations i join settings s on s.installation_id = i.id
      where i.uninstalled_at is null and not i.is_demo and s.digest_enabled and s.slack_webhook_url is not null`;
    let sent = 0;
    for (const r of rows) if (await sendDigest(r.id as string, r.label as string)) sent++;
    return NextResponse.json({ agencies: rows.length, sent });
  } catch (error) {
    console.error("Cron digest failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "Digest failed" }, { status: 500 });
  }
}
