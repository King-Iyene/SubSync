import { sql } from "../db";
import { resolveUser } from "./people-labels";
import { countedDealsOf } from "./waiting-money-queries";
import { accountFacts, rowOut } from "./speed-v2-queries";
import { costEstimate, money } from "./speed-v2";
import { loadLookups, loadTargets } from "./speed-queries";
import { suggestions, type Scope } from "./speed-sql";
import { coverageSql, eventsRecorded, feedSql, journeyMembersSql, journeySql, leakSql, proofSql, scoresSql } from "./speed-sql-cards";
import { DAY } from "./speed-v3";
import { MIN_FOR_MEDIAN, sourceLabel } from "./speed-intel";
import { afterHoursCover, bestTimes, channelMix, leadQuality, MIN_BUCKET, missedCalls, recoveredIn15, routingCheck, textBackAudit } from "./speed-v4";
import { STEPS, type LeadFilter, type Step } from "./speed-v4-more";
import { leadStory, loadTouchEvents } from "./touch-events-db";
import type { Channel } from "./touch-events";
import { raceExtras } from "./speed5-queries";

// The reads behind the rebuilt Speed to lead (stage SPEED4). Read only. Every query is bound to the accounts the router allowed (`allowed`), never to an id from the browser. Money is shown as
// counted deals (facts) and, only where the account has enough closed deals, as an estimate that says so. The text of a message is never read.
export type Input = { installationId: string; allowed: string[] | null; targetMinutes: number; now: number; seePeople: boolean; filter?: LeadFilter; /** The bar's dates in ms (end exclusive). Absent means the usual last 30 days. */ winFrom?: number; winTo?: number };
const CAP_KEYS = 4000;

async function dollarsOf(installationId: string, keys: readonly string[]): Promise<{ map: Map<string, number>; deals: number }> {
  const map = new Map<string, number>(); let deals = 0;
  const deal = await countedDealsOf(installationId, keys.slice(0, CAP_KEYS)).catch(() => []);
  for (const d of deal) { const k = `${d.locationId}:${d.contactId}`; map.set(k, (map.get(k) ?? 0) + d.value); deals += 1; }
  return { map, deals };
}

/** What a person-in-a-hurry needs first: the race, in money. Every figure is an aggregate over the lead set (speed-sql-cards.ts); only the live feed (60 newest leads) is read row by row. */
export async function speedRace(i: Input) {
  const db = sql();
  const f = i.filter ?? {};
  const targets = await loadTargets(db, i.installationId);
  const s: Scope = { installationId: i.installationId, allowed: i.allowed, targetMinutes: i.targetMinutes, now: i.now, fromMs: i.now - 30 * DAY, toMs: i.now + DAY, targetsReady: targets.ready };
  const feedS: Scope = { ...s, fromMs: i.now - 48 * 3_600_000 };
  const [{ lk, locs }, leak, scoreRows, feedRaw, facts] = await Promise.all([
    loadLookups(db, i.installationId, i.allowed, i.targetMinutes, i.now), leakSql(db, s, f), scoresSql(db, s, f), feedSql(db, feedS, f, 60), accountFacts(i.installationId, i.allowed),
  ]);
  // Money leaking this month: leads with no person touch, or a slow one. Counted deals of those people are the fact; the estimate needs enough closed deals.
  const est = costEstimate(leak.byLoc, facts ?? []);
  const counted = { dollars: leak.dollars, withDeals: leak.people };
  // The live race: every lead of the last 48 hours, newest first, with what each needs.
  const feedRows = feedRaw.map((x) => x.row);
  const sugg = await suggestions(db, s, [...new Set(feedRows.map((r) => r.locationId))]);
  const fd = await dollarsOf(i.installationId, feedRows.map((r) => `${r.locationId}:${r.contactId}`));
  const feed = feedRaw.map(({ row: r, status }) => ({
    ...rowOut(r, status, lk, sugg), arrivedAt: r.leadAt, touchedAt: r.touchAt, targetMinutes: r.targetMinutes ?? i.targetMinutes,
    quality: leadQuality({ phone: r.phone, email: r.email, source: r.source }).score, dollars: fd.map.get(`${r.locationId}:${r.contactId}`) ?? 0,
  }));
  const losingNow0 = feed.filter((x) => x.touchedAt === null && x.status === "waiting");
  // Stage SPEED5: the money meter, the duplicate guard, repeat enquirers and the round-robin suggestion. A failure here never stops the Race.
  const ex = await raceExtras(i, feed.map((x) => ({ locationId: x.locationId, contactId: x.contactId, name: x.name, email: x.email, phone: x.phone, arrivedAt: x.arrivedAt, touchedAt: x.touchedAt, unassigned: x.unassigned, dollars: x.dollars })), losingNow0.reduce((n, x) => n + x.dollars, 0)).catch(() => null);
  const feed5 = feed.map((x) => { const e = ex?.byKey.get(`${x.locationId}:${x.contactId}`); return { ...x, duplicateOf: e?.dup ?? null, repeat: (e?.boost ?? 0) > 0, roundRobin: e?.roundRobin ?? null }; });
  const score = (r: { judged: number; within: number; secs: number | null } | undefined) => {
    const judged = r?.judged ?? 0, within = r?.within ?? 0, enough = judged >= MIN_FOR_MEDIAN;
    return { judged, within, score: enough ? Math.round((within / judged) * 100) : null, medianSeconds: enough ? r?.secs ?? null : null, enough };
  };
  const scores = scoreRows.filter((r) => r.loc !== null).map((r) => ({ locationId: r.loc as string, name: lk.locationNames.get(r.loc as string) ?? "Client account", ...score(r) })).sort((a, b) => (a.score ?? 101) - (b.score ?? 101));
  return {
    now: i.now, targetMinutes: i.targetMinutes, accounts: locs.length, overall: score(scoreRows.find((r) => r.loc === null)), scores: scores.slice(0, 12),
    leak: { leads: leak.leaked, noTouch: leak.noTouch, slow: leak.leaked - leak.noTouch, countedDollars: counted.dollars, countedPeople: counted.withDeals, countedDeals: leak.deals, estimate: est.amount === null ? null : { amount: est.amount, line: money(est.amount), accounts: est.countedAccounts, leftOut: est.leftOutAccounts } },
    losing: { count: losingNow0.length, dollars: losingNow0.reduce((n, x) => n + x.dollars, 0) }, feed: feed5, risk: ex?.meter ?? null,
  };
}

/** One list of missed calls and what is missing after them, ranked by the open deal dollars of that person. */
export async function speedCoverage(i: Input) {
  const db = sql();
  const f = i.filter ?? {};
  const targets = await loadTargets(db, i.installationId);
  const s: Scope = { installationId: i.installationId, allowed: i.allowed, targetMinutes: i.targetMinutes, now: i.now, fromMs: i.winFrom ?? i.now - 30 * DAY, toMs: i.winTo ?? i.now + DAY, targetsReady: targets.ready };
  const [{ lk, locs }, events, cov] = await Promise.all([loadLookups(db, i.installationId, i.allowed, i.targetMinutes, i.now), loadTouchEvents(i.installationId, i.allowed, i.now - 30 * DAY), coverageSql(db, s, f)]);
  const tz = new Map<string, string | null>(locs.map((l) => [l.location_id as string, (l.timezone as string | null) ?? null]));
  const tzOf = (l: string) => tz.get(l) ?? null;
  const calls = missedCalls(events, i.now);
  const unrecovered = calls.filter((c) => !recoveredIn15(c));
  const recoveredList = calls.filter(recoveredIn15);
  const keys = unrecovered.map((c) => `${c.locationId}:${c.contactId}`);
  const [{ map: dollars }, facts] = await Promise.all([dollarsOf(i.installationId, keys), accountFacts(i.installationId, i.allowed)]);
  // The people behind the missed calls (name, phone, owner), read from the synced contacts of the caller's own accounts only.
  const people = new Map<string, Record<string, unknown>>();
  if (unrecovered.length || recoveredList.length) {
    const rs = await db`select location_id, contact_id, full_name, email, phone, dnd, source, nullif(assigned_to, '') assigned_to from cached_contacts
      where installation_id = ${i.installationId} and contact_id = any(${[...new Set([...unrecovered.slice(0, 200), ...recoveredList.slice(0, 50)].map((c) => c.contactId))]}::text[]) ${i.allowed ? db`and location_id = any(${i.allowed}::text[])` : db``}`;
    for (const r of rs) people.set(`${r.location_id}:${r.contact_id}`, r);
  }
  const rowFor = (c: (typeof calls)[number]) => {
    const p = people.get(`${c.locationId}:${c.contactId}`) ?? {};
    const owner = p.assigned_to ? resolveUser(p.assigned_to as string, lk.team, lk.usersAccess.get(c.locationId)) : null;
    return {
      locationId: c.locationId, locationName: lk.locationNames.get(c.locationId) ?? "Client account", contactId: c.contactId, name: ((p.full_name as string) || (p.email as string) || (p.phone as string) || "Unknown caller"),
      status: "waiting" as const, neverAnswered: c.status === "dropped", minutes: Math.round((i.now - c.at) / 60_000), source: sourceLabel((p.source as string | null) ?? null), repliedBy: null, owner, unassigned: !owner, autoSeconds: null, personSeconds: null, detailed: false,
      phone: (p.phone as string | null) ?? null, email: (p.email as string | null) ?? null, dnd: p.dnd === true, timeZone: tzOf(c.locationId), suggestion: null, calledAt: c.at, dollars: dollars.get(`${c.locationId}:${c.contactId}`) ?? 0, callState: c.status,
    };
  };
  const missedRows = unrecovered.slice(0, 200).map(rowFor).sort((a, b) => b.dollars - a.dollars || b.calledAt - a.calledAt);
  const recoveredRows = recoveredList.slice(0, 50).map(rowFor);
  const nightEst = costEstimate(cov.lostByLoc, facts ?? []);
  const route = routingCheck(cov.owned, cov.repliers);
  const nameOf = (u: string) => resolveUser(u, lk.team, null).label;
  const cover = afterHoursCover([], events, tzOf);
  const share = cov.afterLeads >= MIN_BUCKET ? Math.round((cov.answeredSameNight / cov.afterLeads) * 100) : null;
  return {
    now: i.now,
    missed: { total: calls.length, recovered15: calls.filter(recoveredIn15).length, unrecovered: unrecovered.length, dollars: missedRows.reduce((s2, r) => s2 + r.dollars, 0), rows: missedRows.slice(0, 50), recoveredRows, audit: textBackAudit(calls) },
    night: { rows: cov.lostRows.slice(0, 50).map((x) => rowOut(x.row, x.status, lk, new Map())), lost: cov.lost, countedDollars: cov.lostDollars, estimate: nightEst.amount === null ? null : { amount: nightEst.amount, line: money(nightEst.amount) }, hoursToCover: cov.hoursToCover.slice(0, 8), afterLeads: cov.afterLeads, answeredSameNight: cov.answeredSameNight, share, cover: cover.cover.map((c) => ({ ...c, name: nameOf(c.userId) })) },
    best: bestTimes(events, tzOf), channels: channelMix(events), eventsStored: events.length,
    routing: { ...route, noLeads: route.noLeads.map((u) => ({ userId: u, name: nameOf(u) })), overloaded: route.overloaded.map((u) => ({ userId: u, name: nameOf(u), leads: cov.owned.get(u) ?? 0 })) },
  };
}

/** Kept for callers that still need the contact keys that sent something back: it reads the stored touch events (newest 60,000), never the lead rows. */
export async function repliedSet(installationId: string, allowed: string[] | null, rows: readonly { locationId: string; contactId: string; touchAt: number | null }[], now: number) {
  const events = await loadTouchEvents(installationId, allowed, now - 60 * DAY);
  const first = new Map<string, number>(); const channels = new Map<string, Set<Channel>>();
  const touchAt = new Map(rows.map((r) => [`${r.locationId}:${r.contactId}`, r.touchAt]));
  for (const e of events) {
    const k = `${e.locationId}:${e.contactId}`;
    if (e.direction === "outbound" && !e.automated) { const s = channels.get(k) ?? new Set<Channel>(); s.add(e.channel); channels.set(k, s); }
    const t = touchAt.get(k);
    if (e.direction === "inbound" && t != null && e.at > t) { const d = Math.round((e.at - t) / 1000); const cur = first.get(k); if (cur === undefined || d < cur) first.set(k, d); }
  }
  return { replied: events.length ? new Set(first.keys()) : null, first, channels };
}

/** The lead journey for the filtered leads of the window: counts, drop-off, median time between steps, all in one aggregate. */
export async function speedJourney(i: Input) {
  const db = sql();
  const targets = await loadTargets(db, i.installationId);
  const s: Scope = { installationId: i.installationId, allowed: i.allowed, targetMinutes: i.targetMinutes, now: i.now, fromMs: i.winFrom ?? i.now - 30 * DAY, toMs: i.winTo ?? i.now + DAY, targetsReady: targets.ready };
  const recorded = await eventsRecorded(db, s);
  return { now: i.now, steps: await journeySql(db, s, i.filter ?? {}, recorded), repliedRecorded: recorded };
}
export async function speedJourneyList(i: Input & { step: Step; dropped: boolean }) {
  const db = sql();
  const targets = await loadTargets(db, i.installationId);
  const s: Scope = { installationId: i.installationId, allowed: i.allowed, targetMinutes: i.targetMinutes, now: i.now, fromMs: i.winFrom ?? i.now - 30 * DAY, toMs: i.winTo ?? i.now + DAY, targetsReady: targets.ready };
  const [{ lk }, recorded] = await Promise.all([loadLookups(db, i.installationId, i.allowed, i.targetMinutes, i.now), eventsRecorded(db, s)]);
  const m = await journeyMembersSql(db, s, i.filter ?? {}, recorded, i.step, i.dropped, 100);
  const sugg = await suggestions(db, s, [...new Set(m.rows.map((x) => x.row.locationId))]);
  return { count: m.count, shown: m.rows.length, rows: m.rows.map((x) => rowOut(x.row, x.status, lk, sugg)) };
}
export const isStep = (s: string | null): s is Step => !!s && (STEPS as readonly string[]).includes(s);

/** The printable proof for each account: this month against last month. Facts only; a score needs enough judged leads. */
export async function speedProof(i: Input) {
  const db = sql();
  const targets = await loadTargets(db, i.installationId);
  const s: Scope = { installationId: i.installationId, allowed: i.allowed, targetMinutes: i.targetMinutes, now: i.now, fromMs: i.now - 60 * DAY, toMs: i.now + DAY, targetsReady: targets.ready };
  const [{ lk }, rows] = await Promise.all([loadLookups(db, i.installationId, i.allowed, i.targetMinutes, i.now), proofSql(db, s)]);
  const score = (r: { judged: number; within: number; med: number | null } | undefined) => {
    const judged = r?.judged ?? 0, within = r?.within ?? 0, enough = judged >= MIN_FOR_MEDIAN;
    return { judged, within, score: enough ? Math.round((within / judged) * 100) : null, medianSeconds: enough ? r?.med ?? null : null, enough };
  };
  const by = new Map<string, { now?: (typeof rows)[number]; before?: (typeof rows)[number] }>();
  for (const r of rows) { const e = by.get(r.loc) ?? {}; if (r.cur) e.now = r; else e.before = r; by.set(r.loc, e); }
  const accounts = [...by].map(([locationId, e]) => ({ locationId, name: lk.locationNames.get(locationId) ?? "Client account", leads: e.now?.leads ?? 0, now: score(e.now), before: score(e.before),
    within5: e.now && e.now.replied >= 5 ? { replied: e.now.replied, inside: e.now.q5 } : null })).sort((a, b) => b.leads - a.leads);
  return { now: i.now, targetMinutes: i.targetMinutes, accounts };
}

/** One lead, start to finish (lifecycle events, touches by kind, stage, tag and appointment history). The contact must belong to an account the caller may read. */
export async function speedStory(i: Input & { locationId: string; contactId: string }) {
  if (i.allowed && !i.allowed.includes(i.locationId)) return { events: [] };
  return { events: await leadStory(i.installationId, i.locationId, i.contactId) };
}
