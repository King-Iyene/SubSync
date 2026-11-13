import { flagsOf, type DhContact, type Settings } from "./rules.ts";

export type Spike = { source: string; recent: number; created: number; baselinePerDay: number; kinds: Record<string, number>; contactIds: string[]; newestMinutes: number | null };
const BAD = new Set(["duplicate", "junk", "bad_phone", "bad_email"]);
const DAY = 86_400_000;

/** Quality firewall (detect only). For each source: bad records created in the last 24 hours against the same account's own daily average of the 14 days before.
 *  Raised when there are at least `spikeMin` bad ones and at least 3 times the usual (usual counts as 1 when it is lower), and they are at least a third of what the source created. */
export function findSpikes(contacts: DhContact[], dupExtras: Set<string>, s: Settings, now: number): Spike[] {
  const by = new Map<string, { recentBad: string[]; kinds: Record<string, number>; prior: number; created: number; newest: number | null }>();
  for (const c of contacts) {
    if (c.dateAdded === null || now - c.dateAdded > 15 * DAY) continue;
    const src = (c.source ?? "").trim() || "Unknown source";
    const e = by.get(src) ?? { recentBad: [], kinds: {}, prior: 0, created: 0, newest: null };
    const bad = flagsOf(c, dupExtras.has(c.contactId), s, now).filter((r) => BAD.has(r));
    if (now - c.dateAdded <= DAY) {
      e.created++;
      if (bad.length) { e.recentBad.push(c.contactId); e.newest = e.newest === null ? now - c.dateAdded : Math.min(e.newest, now - c.dateAdded); for (const r of bad) e.kinds[r] = (e.kinds[r] ?? 0) + 1; }
    } else if (bad.length) e.prior++;
    by.set(src, e);
  }
  const out: Spike[] = [];
  for (const [source, e] of by) {
    const usual = e.prior / 14, recent = e.recentBad.length;
    if (recent >= s.spikeMin && recent >= 3 * Math.max(usual, 1) && recent >= e.created / 3) out.push({ source, recent, created: e.created, baselinePerDay: Math.round(usual * 10) / 10, kinds: e.kinds, contactIds: e.recentBad, newestMinutes: e.newest === null ? null : Math.max(0, Math.round(e.newest / 60_000)) });
  }
  return out.sort((a, b) => b.recent - a.recent);
}
export const spikeKey = (loc: string, source: string, day: string) => `dh:spike:${loc}:${source.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40)}:${day}`;
export const spikeTitle = (account: string, sp: Spike) => `${account}: ${sp.recent} bad records came in from ${sp.source} in the last 24 hours (usually ${sp.baselinePerDay} a day)`;
