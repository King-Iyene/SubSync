import { realTransports } from "../notifications/transports";
import { isLive } from "../live-flags";
import { postToSlack } from "../notify";
import { sql } from "../db";
import { median } from "./pipeline-intel";
import { responseSeconds, judge } from "./speed-intel";
import { loadRows } from "./speed-queries";
import { buildMessage, DEFAULT_DIGEST, isDue, sanitizeDigest, scheduleKey, type DigestSettings, type Numbers } from "./speed-digest";

// Storage and sending for the Speed summary (stage SPEED6). Reads and writes only the caller's installation. A missing table (the migration has not run) answers `ready: false`, never an error screen.
// Sending goes through the one outward gate (email.ts and notify.ts): with SEND_EMAIL_LIVE or SEND_SLACK_LIVE off it writes a "WOULD SEND" audit line and sends nothing.
const DAY = 86_400_000;
const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export async function loadDigest(installationId: string, locationId: string): Promise<{ ready: boolean; settings: DigestSettings; lastKey: string | null }> {
  try {
    const [r] = await sql()`select settings, last_sent_key from speed_digest where installation_id = ${installationId} and location_id = ${locationId}`;
    return { ready: true, settings: r ? sanitizeDigest(r.settings) : DEFAULT_DIGEST, lastKey: (r?.last_sent_key as string | null) ?? null };
  } catch { return { ready: false, settings: DEFAULT_DIGEST, lastKey: null }; }
}
export async function saveDigest(installationId: string, locationId: string, raw: unknown): Promise<{ ok: true; settings: DigestSettings } | { ok: false; error: string }> {
  const settings = sanitizeDigest(raw);
  try {
    await sql()`
      insert into speed_digest (installation_id, location_id, settings) values (${installationId}, ${locationId}, ${JSON.stringify(settings)}::text::jsonb)
      on conflict (installation_id, location_id) do update set settings = excluded.settings, updated_at = now()`;
    return { ok: true, settings };
  } catch { return { ok: false, error: "Saving needs the latest database update. Ask the person who manages SubSync to apply it, then try again." }; }
}

/** The numbers on the screen, for the last 7 days: the same judge and the same minimums (5 leads for a figure). */
export async function digestNumbers(installationId: string, allowed: string[] | null, who: string, targetMinutes: number, now: number): Promise<Numbers> {
  const rows = await loadRows(sql(), installationId, allowed, now - 7 * DAY, now + DAY);
  let within = 0, judged = 0, leaked = 0, noOwner = 0; const secs: number[] = [];
  for (const r of rows) {
    const j = judge(r, targetMinutes, now);
    if (j) { judged++; if (j === "within") within++; else leaked++; }
    if (j === "waiting" && r.assignedTo === null) noOwner++;
    const s = responseSeconds(r); if (s !== null) secs.push(s);
  }
  const waiting = rows.filter((r) => judge(r, targetMinutes, now) === "waiting").length;
  return { who, waiting, typicalSeconds: secs.length >= 5 ? median(secs) : null, inTimePct: judged >= 5 ? Math.round((within / judged) * 100) : null, leaked, noOwner };
}

export type SendReport = { channel: "email" | "slack"; to: number; live: boolean };
/** Sends (or dry-runs) one message on the chosen channels. `test` goes to the first address only, with "Test:" in the subject. */
export async function deliver(installationId: string, s: DigestSettings, n: Numbers, o: { test: boolean }): Promise<SendReport[]> {
  const m = buildMessage(s, n);
  const out: SendReport[] = [];
  const subject = o.test ? `Test: ${m.subject}` : m.subject;
  if (s.email && s.recipients.length) {
    const to = o.test ? s.recipients.slice(0, 1) : s.recipients;
    const mailer = realTransports(installationId, () => null);
    for (const addr of to) await mailer.email(addr, { subject, text: m.text, html: `<p>${esc(m.text).replace(/\n\n/g, "</p><p>").replace(/\n/g, "<br>")}</p>` }, []);
    out.push({ channel: "email", to: to.length, live: isLive("SEND_EMAIL_LIVE") });
  }
  if (s.slack) {
    let url: string | null = null;
    try { const [r] = await sql()`select slack_webhook_url from settings where installation_id = ${installationId}`; url = (r?.slack_webhook_url as string | null) ?? null; } catch { url = null; }
    if (url) { await postToSlack(url, `${o.test ? "Test: " : ""}${subject}\n${m.text}`, { installationId, what: "slack.speed_digest" }); out.push({ channel: "slack", to: 1, live: isLive("SEND_SLACK_LIVE") }); }
  }
  return out;
}

/** The scheduled run: every enabled summary that is due (its own local time and weekday, once per key). Safe to call every hour, or late. */
export async function runSpeedDigests(now = Date.now()): Promise<{ checked: number; sent: number }> {
  let rows;
  try {
    rows = await sql()`
      select d.installation_id, d.location_id, d.settings, d.last_sent_key, coalesce(i.company_name, 'Your company') label, coalesce(st.speed_target_minutes, 15) target
      from speed_digest d join installations i on i.id = d.installation_id left join settings st on st.installation_id = d.installation_id
      where i.uninstalled_at is null and not i.is_demo and d.settings->>'enabled' = 'true' limit 500`;
  } catch { return { checked: 0, sent: 0 }; }
  let sent = 0;
  for (const r of rows) {
    const s = sanitizeDigest(r.settings);
    if (!s.enabled || !isDue(now, s.schedule, (r.last_sent_key as string | null) ?? null)) continue;
    const inst = r.installation_id as string; const loc = r.location_id as string;
    let who = r.label as string;
    if (loc) { const [l] = await sql()`select name from locations where installation_id = ${inst} and location_id = ${loc}`; who = (l?.name as string | null) ?? who; }
    const n = await digestNumbers(inst, loc ? [loc] : null, who, r.target as number, now);
    // Claim the key first: a second run in the same hour finds it taken and sends nothing.
    const claimed = await sql()`update speed_digest set last_sent_key = ${scheduleKey(now, s.schedule)} where installation_id = ${inst} and location_id = ${loc} and last_sent_key is not distinct from ${(r.last_sent_key as string | null) ?? null} returning 1`;
    if (claimed.length === 0) continue;
    await deliver(inst, s, n, { test: false });
    sent++;
  }
  return { checked: rows.length, sent };
}
