import { sql } from "../db";
import { dispatchAlerts } from "../notifications/service";
import { resolveEntitlements } from "../flags";
import { outward } from "../live-flags";
import { unsubscribeUrl } from "../unsubscribe";
import { getSettings } from "../analytics/queries";
import type { AlertRow } from "../analytics/queries";
import { dueToday } from "../workflows/proof-email";
import { accountNames, isMissing } from "../workflows/store";
import { digestMail } from "./digest";
import { spikeKey, spikeTitle } from "./firewall";
import { closeOutcomes, dayOf, loadSnapshots, openOutcome, snapshotAccount, type Computed } from "./store";
import { ruleOf } from "./rules";

// The daily snapshot, the quality firewall alerts and the weekly digest (a rehearsal: only the notification dispatcher may send mail). Read only toward the CRM.
// Per company, a few client accounts per run (the least recently scored first), so a large agency is covered over the day.
export const PER_RUN_ACCOUNTS = 6;
export const MAX_COMPANIES = 60;
export type CronReport = { companies: number; accounts: number; alerts: number; digests: number };

/** Raises the spike alerts as ordinary alerts (kind "quality"), de-duplicated by key, and resolves the ones whose condition has cleared. Records every outcome. */
export async function raiseSpikes(installationId: string, accounts: Array<{ locationId: string; name: string }>, results: Computed[], keepOthers: string[] = []): Promise<AlertRow[]> {
  const created: AlertRow[] = [];
  const name = new Map(accounts.map((a) => [a.locationId, a.name]));
  const keys: string[] = [...keepOthers];
  try {
    await sql().begin(async (tx) => {
      for (const r of results) for (const sp of r.spikes) {
        const key = spikeKey(r.locationId, sp.source, r.day), title = spikeTitle(name.get(r.locationId) ?? "A client account", sp);
        keys.push(key);
        const [row] = await tx`insert into alerts (installation_id, location_id, kind, severity, title, detail, dedupe_key) values (${installationId}, ${r.locationId}, 'quality', 'warning', ${title}, ${tx.json({ source: sp.source, recent: sp.recent, usual: sp.baselinePerDay, created: sp.created, newestMinutes: sp.newestMinutes, kinds: sp.kinds, why: "Your own normal for this source is much lower. Check the import or form that sends these." } as never)}, ${key})
          on conflict (installation_id, dedupe_key) where resolved_at is null do update set title = excluded.title, detail = excluded.detail
          returning id, (xmax = 0) as inserted`;
        if (row?.inserted) created.push({ id: row.id as string, locationId: r.locationId, kind: "quality", severity: "warning", title, detail: {}, createdAt: new Date().toISOString(), resolvedAt: null });
      }
      await tx`update alerts set resolved_at = now() where installation_id = ${installationId} and resolved_at is null and dedupe_key like 'dh:spike:%' and not (dedupe_key = any(${keys}::text[]))`;
    });
    for (const r of results) for (const sp of r.spikes) await openOutcome(installationId, r.locationId, spikeKey(r.locationId, sp.source, r.day), spikeTitle(name.get(r.locationId) ?? "A client account", sp));
    await closeOutcomes(installationId, keys, "SubSync", "The bad records stopped coming in or were cleaned up");
  } catch (e) {
    if (isMissing(e)) return [];
    throw e;
  }
  return created;
}

export async function runDataHealthCron(now = new Date()): Promise<CronReport> {
  const rep: CronReport = { companies: 0, accounts: 0, alerts: 0, digests: 0 };
  let rows;
  try { rows = await sql()`select id, plan from installations where uninstalled_at is null and not is_demo order by id limit ${MAX_COMPANIES}`; } catch { return rep; }
  for (const inst of rows) {
    const installationId = inst.id as string;
    const ent = await resolveEntitlements((inst.plan as never) ?? "pro", installationId).catch(() => null);
    if (!ent || ent.features.data_health === false || ent.features.data_health_pro === false || ent.locked.includes("data_health_pro")) continue;
    rep.companies++;
    const accounts = (await accountNames(installationId, null)).filter((a) => !a.ignored);
    const snaps = await loadSnapshots(installationId, null, dayOf(now.getTime() - 3 * 86_400_000));
    const last = new Map<string, string>();
    for (const s of snaps) last.set(s.locationId, s.day);
    const order = [...accounts].sort((a, b) => (last.get(a.locationId) ?? "").localeCompare(last.get(b.locationId) ?? "")).slice(0, PER_RUN_ACCOUNTS);
    const results: Computed[] = [];
    for (const a of order) { results.push(await snapshotAccount(installationId, a.locationId, now.getTime()).catch(() => null as never)); rep.accounts++; }
    const good = results.filter(Boolean);
    // Spike alerts of accounts not scored in this run stay as they are.
    const other = await sql()`select dedupe_key from alerts where installation_id = ${installationId} and resolved_at is null and dedupe_key like 'dh:spike:%'`.catch(() => []);
    const scoredLocs = new Set(good.map((r) => r.locationId));
    const keep = other.map((r) => r.dedupe_key as string).filter((k) => !scoredLocs.has(k.split(":")[2]));
    const created = await raiseSpikes(installationId, accounts, good, keep);
    if (created.length) { rep.alerts += created.length; await dispatchAlerts(installationId, created).catch(() => null); }
    if (await sendDigest(installationId, accounts, now)) rep.digests++;
  }
  return rep;
}

async function sendDigest(installationId: string, accounts: Array<{ locationId: string; name: string }>, now: Date): Promise<boolean> {
  const [s] = await sql()`select digest_email, digest_enabled, digest_timezone, brand_name from settings where installation_id = ${installationId}`.catch(() => []);
  if (!s?.digest_email || s.digest_enabled === false) return false;
  const [lastSent] = await sql()`select filters from saved_views where installation_id = ${installationId} and owner = 'system' and page = 'data_health_digest' and name = 'sent'`.catch(() => []);
  const [first] = await sql()`select timezone from locations where installation_id = ${installationId} and timezone is not null order by name limit 1`.catch(() => []);
  const due = dueToday(now, (s.digest_timezone as string | null) ?? (first?.timezone as string | null) ?? "UTC", ((lastSent?.filters ?? {}) as { day?: string }).day ?? null);
  if (!due.due) return false;
  const snaps = await loadSnapshots(installationId, null, dayOf(now.getTime() - 9 * 86_400_000));
  const view = accounts.map((a) => {
    const h = snaps.filter((x) => x.locationId === a.locationId), l = h[h.length - 1], p = h[0];
    return { name: a.name, locationId: a.locationId, score: l?.score ?? null, weekAgo: p && p !== l ? p.score : null, top: (l?.components ?? []).filter((c) => c.count > 0).sort((x, y) => y.penalty - x.penalty).slice(0, 3).map((c) => ({ label: ruleOf(c.id)?.label ?? c.id, count: c.count })) };
  });
  if (!view.some((v) => v.score !== null)) return false;
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/+$/, "");
  const mail = digestMail({ brand: (s.brand_name as string | null) ?? "Your data health", accounts: view, crmDomain: (await getSettings(installationId)).appDomain, stopUrl: unsubscribeUrl(appUrl, installationId, s.digest_email as string) });
  void mail;
  // A rehearsal even with the live switch on: the dispatcher is the only sender and it has no data health digest type yet.
  const done = await outward({ flag: "SEND_EMAIL_LIVE", verb: "SEND", what: "data_health.digest.email", installationId }, async () => false);
  await sql()`insert into saved_views (installation_id, owner, page, name, filters) values (${installationId}, 'system', 'data_health_digest', 'sent', ${sql().json({ day: due.day } as never)})
    on conflict (installation_id, owner, page, name) do update set filters = excluded.filters`.catch(() => null);
  return done.live ? done.result : true;
}
