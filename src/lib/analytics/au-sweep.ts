import { sql } from "../db";
import { deepLinks } from "../links";
import { realTransports } from "../notifications/transports";
import { loadCore, type AuditBase } from "../api/audit-api";
import { appointmentView } from "./appointment-queries";
import { conversationCoverage } from "./queries";
import { loadAccountsNow } from "./service";
import { CONVERSATIONS_READ_PER_ACCOUNT, readLimitNote } from "./waiting";
import { MIN_DAYS_THEN_NOW, comparePairs, monthlyMessage, runsFromAudit, type Pair } from "./au-history";
import { claimMonthly, latestRuns, readPrefs, recordRuns, runsNear } from "./au-history-queries";

// The hourly Account audit sweep (flags au_history and au_monthly). It reads the audit the same way the page does, for the company's own accounts, and stores one
// count row per account per day. It writes only SubSync's own tables; the monthly message goes through the gated email transport (a dry run until the live switch is on)
// and only ever to the company's own summary address. Idempotent: a second run the same day or month changes nothing.

const DAY = 86_400_000;
const day = (now: number) => new Date(now).toISOString().slice(0, 10);

/** Records today's counts for every account that has none yet or whose newest run is 6 or more days old. Accounts still being read for the first time are skipped. */
export async function sweepAuditHistory(installationId: string, now: number): Promise<number> {
  const { settings, accounts } = await loadAccountsNow(installationId);
  const live = accounts.filter((a) => !a.ignored);
  const ids = live.map((a) => a.locationId);
  if (ids.length === 0) return 0;
  const [d] = await sql()`select count(distinct location_id)::int have, max(run_day)::text latest from au_runs where installation_id = ${installationId} and location_id = any(${ids}::text[])`;
  const latest = (d?.latest as string | null) ?? null;
  const stale = latest === null || (Date.parse(`${day(now)}T00:00:00Z`) - Date.parse(`${latest}T00:00:00Z`)) / DAY >= 6;
  if (!stale && (d?.have as number) >= ids.length) return 0;
  const idSet = new Set(ids);
  const base = async (): Promise<AuditBase> => {
    const [apptView, coverage] = await Promise.all([appointmentView(installationId, ids), conversationCoverage(installationId)]);
    return { settings, live, apptView, links: deepLinks(settings.appDomain), readLimit: readLimitNote(coverage.filter((c) => idSet.has(c.locationId) && c.stored >= CONVERSATIONS_READ_PER_ACCOUNT).length, live.length) };
  };
  const core = await loadCore({ installationId, ids, limitTo: null, now, base: await base() });
  const unread = new Set(core.unreadIds);
  const runs = runsFromAudit(core.audit, core.accounts, core.calendars).filter((r) => !unread.has(r.locationId));
  return recordRuns(installationId, runs, now, "sweep");
}

/** Once a month (first run after 08:00 UTC in the first week) to the company's own summary address: what got better, what got worse, one link. */
export async function sendMonthlyAudit(installationId: string, now: number): Promise<{ sent: boolean; reason?: string }> {
  const dt = new Date(now);
  if (dt.getUTCDate() > 7 || dt.getUTCHours() < 8) return { sent: false, reason: "not due" };
  const { settings, accounts } = await loadAccountsNow(installationId);
  const to = settings.digestEmail;
  if (!to) return { sent: false, reason: "no address" };
  const live = accounts.filter((a) => !a.ignored);
  const ids = live.map((a) => a.locationId);
  const prefs = await readPrefs(installationId, ids);
  if (!prefs.on) return { sent: false, reason: "off" };
  const muted = new Set(prefs.muted);
  const use = ids.filter((id) => !muted.has(id));
  const [latest, near] = await Promise.all([latestRuns(installationId, use), runsNear(installationId, use, now, 20)]);
  const names = new Map(live.map((a) => [a.locationId, a.name ?? "Unnamed account"]));
  const pairs: Pair[] = [];
  for (const id of use) { const l = latest.get(id), n = near.get(id); if (l && n && n.runDay < l.runDay) pairs.push({ then: n, now: l }); }
  const c = comparePairs(pairs, Math.min(14, MIN_DAYS_THEN_NOW * 2));
  const ok = pairs.filter((p) => p.then.rulesVersion === p.now.rulesVersion && !p.then.partial && !p.now.partial && Date.parse(`${p.now.runDay}T00:00:00Z`) - Date.parse(`${p.then.runDay}T00:00:00Z`) >= 14 * DAY);
  if (ok.length === 0) return { sent: false, reason: "not enough history" };
  const sum = (c2: Pair["then"]["counts"]) => Object.values(c2).reduce<number>((s, v) => s + (v ?? 0), 0);
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/+$/, "");
  const msg = monthlyMessage({
    who: settings.brandName ?? "your company", fromDay: ok.map((p) => p.then.runDay).sort()[0], toDay: ok.map((p) => p.now.runDay).sort().slice(-1)[0],
    accounts: ok.map((p) => ({ name: names.get(p.now.locationId) ?? "Client account", then: sum(p.then.counts), now: sum(p.now.counts) })),
    link: `${base}/app#audit`, estimate: c.estimate,
  });
  if (!msg) return { sent: false, reason: "nothing to say" };
  const key = `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}`;
  if (!(await claimMonthly(installationId, key))) return { sent: false, reason: "already sent" };
  const html = `<p>${msg.text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\n\n/g, "</p><p>").replace(/\n/g, "<br>")}</p>`;
  await realTransports(installationId, () => null).email(to, { subject: msg.subject, text: msg.text, html }, []);
  return { sent: true };
}
