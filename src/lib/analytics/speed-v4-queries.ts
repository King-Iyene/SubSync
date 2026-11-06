import { sql } from "../db";
import { resolveUser } from "./people-labels";
import { countedDealsOf } from "./waiting-money-queries";
import { accountFacts, rowOut, suggestionsFor } from "./speed-v2-queries";
import { costEstimate, money } from "./speed-v2";
import { loadLookups, loadRows } from "./speed-queries";
import { isAfterHours, DAY, type Outcomes } from "./speed-v3";
import { judge, sourceLabel } from "./speed-intel";
import { bestTimes, channelMix, leadQuality, missedCalls, raceMoney, recoveredIn15, routingCheck, speedScore, textBackAudit, afterHoursCover } from "./speed-v4";
import { applyFilter, journey, journeyMembers, lostAtNight, proofByAccount, STEPS, type LeadFilter, type Step } from "./speed-v4-more";
import { leadStory, loadTouchEvents } from "./touch-events-db";
import { outcomesOf } from "./speed-v3-queries";
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

/** What a person-in-a-hurry needs first: the race, in money. */
export async function speedRace(i: Input) {
  const db = sql();
  const o = { targetMinutes: i.targetMinutes, now: i.now };
  const [{ lk, locs }, all] = await Promise.all([loadLookups(db, i.installationId, i.allowed, i.targetMinutes, i.now), loadRows(db, i.installationId, i.allowed, i.now - 30 * DAY, i.now + DAY)]);
  const rows = applyFilter(all, i.filter ?? {}, o);
  const month = rows.filter((r) => r.leadAt > i.now - 30 * DAY);
  // Money leaking this month: leads with no person touch, or a slow one. Counted deals of those people are the fact; the estimate needs enough closed deals.
  const leaked = month.filter((r) => { const j = judge(r, i.targetMinutes, i.now); return j === "late" || j === "waiting"; });
  const noTouch = leaked.filter((r) => r.touchAt === null).length;
  const keys = leaked.map((r) => `${r.locationId}:${r.contactId}`);
  const [{ map: dollars, deals }, facts] = await Promise.all([dollarsOf(i.installationId, keys), accountFacts(i.installationId, i.allowed)]);
  const byLoc = new Map<string, number>();
  for (const r of leaked) byLoc.set(r.locationId, (byLoc.get(r.locationId) ?? 0) + 1);
  const est = costEstimate(byLoc, facts ?? []);
  const counted = raceMoney(keys.map((key) => ({ key })), dollars);
  // The live race: every lead of the last 48 hours, newest first, with what each needs.
  const feedRows = rows.filter((r) => r.leadAt > i.now - 48 * 3_600_000).sort((a, b) => b.leadAt - a.leadAt).slice(0, 60);
  const sugg = suggestionsFor(feedRows, new Set(feedRows.map((r) => r.locationId)));
  const feedKeys = feedRows.map((r) => `${r.locationId}:${r.contactId}`);
  const fd = await dollarsOf(i.installationId, feedKeys);
  const feed = feedRows.map((r) => ({
    ...rowOut(r, judge(r, i.targetMinutes, i.now) ?? "waiting", lk, sugg), arrivedAt: r.leadAt, touchedAt: r.touchAt, targetMinutes: r.targetMinutes ?? i.targetMinutes,
    quality: leadQuality({ phone: r.phone, email: r.email, source: r.source }).score, dollars: fd.map.get(`${r.locationId}:${r.contactId}`) ?? 0,
  }));
  const losingNow0 = feed.filter((f) => f.touchedAt === null && f.status === "waiting");
  // Stage SPEED5: the money meter, the duplicate guard, repeat enquirers and the round-robin suggestion. A failure here never stops the Race.
  const ex = await raceExtras(i, feed.map((f) => ({ locationId: f.locationId, contactId: f.contactId, name: f.name, email: f.email, phone: f.phone, arrivedAt: f.arrivedAt, touchedAt: f.touchedAt, unassigned: f.unassigned, dollars: f.dollars })), losingNow0.reduce((s, f) => s + f.dollars, 0)).catch(() => null);
  const feed5 = feed.map((f) => { const x = ex?.byKey.get(`${f.locationId}:${f.contactId}`); return { ...f, duplicateOf: x?.dup ?? null, repeat: (x?.boost ?? 0) > 0, roundRobin: x?.roundRobin ?? null }; });
  const losingNow = losingNow0;
  const scores = [...new Set(rows.map((r) => r.locationId))].map((loc) => ({ locationId: loc, name: lk.locationNames.get(loc) ?? "Client account", ...speedScore(rows.filter((r) => r.locationId === loc), i.targetMinutes, i.now) })).sort((a, b) => (a.score ?? 101) - (b.score ?? 101));
  return {
    now: i.now, targetMinutes: i.targetMinutes, accounts: locs.length, overall: speedScore(rows, i.targetMinutes, i.now), scores: scores.slice(0, 12),
    leak: { leads: leaked.length, noTouch, slow: leaked.length - noTouch, countedDollars: counted.dollars, countedPeople: counted.withDeals, countedDeals: deals, estimate: est.amount === null ? null : { amount: est.amount, line: money(est.amount), accounts: est.countedAccounts, leftOut: est.leftOutAccounts } },
    losing: { count: losingNow.length, dollars: losingNow.reduce((s, f) => s + f.dollars, 0) }, feed: feed5, risk: ex?.meter ?? null,
  };
}

/** One list of missed calls and what is missing after them, ranked by the open deal dollars of that person. */
export async function speedCoverage(i: Input) {
  const db = sql();
  const o = { targetMinutes: i.targetMinutes, now: i.now };
  const [{ lk, locs }, all, events] = await Promise.all([loadLookups(db, i.installationId, i.allowed, i.targetMinutes, i.now), loadRows(db, i.installationId, i.allowed, i.winFrom ?? i.now - 30 * DAY, i.winTo ?? i.now + DAY), loadTouchEvents(i.installationId, i.allowed, i.now - 30 * DAY)]);
  const rows = applyFilter(all, i.filter ?? {}, o);
  const tz = new Map<string, string | null>(locs.map((l) => [l.location_id as string, (l.timezone as string | null) ?? null]));
  const tzOf = (l: string) => tz.get(l) ?? null;
  const calls = missedCalls(events, i.now);
  const unrecovered = calls.filter((c) => !recoveredIn15(c));
  const keys = unrecovered.map((c) => `${c.locationId}:${c.contactId}`);
  const [{ map: dollars }, facts] = await Promise.all([dollarsOf(i.installationId, keys), accountFacts(i.installationId, i.allowed)]);
  // The people behind the missed calls (name, phone, owner), read from the synced contacts of the caller's own accounts only.
  const people = new Map<string, Record<string, unknown>>();
  if (unrecovered.length) {
    const rs = await db`select location_id, contact_id, full_name, email, phone, dnd, source, nullif(assigned_to, '') assigned_to from cached_contacts
      where installation_id = ${i.installationId} and contact_id = any(${[...new Set(unrecovered.slice(0, 200).map((c) => c.contactId))]}::text[]) ${i.allowed ? db`and location_id = any(${i.allowed}::text[])` : db``}`;
    for (const r of rs) people.set(`${r.location_id}:${r.contact_id}`, r);
  }
  const missedRows = unrecovered.slice(0, 200).map((c) => {
    const p = people.get(`${c.locationId}:${c.contactId}`) ?? {};
    const owner = p.assigned_to ? resolveUser(p.assigned_to as string, lk.team, lk.usersAccess.get(c.locationId)) : null;
    return {
      locationId: c.locationId, locationName: lk.locationNames.get(c.locationId) ?? "Client account", contactId: c.contactId, name: ((p.full_name as string) || (p.email as string) || (p.phone as string) || "Unknown caller"),
      status: "waiting" as const, neverAnswered: c.status === "dropped", minutes: Math.round((i.now - c.at) / 60_000), source: sourceLabel((p.source as string | null) ?? null), repliedBy: null, owner, unassigned: !owner, autoSeconds: null, personSeconds: null, detailed: false,
      phone: (p.phone as string | null) ?? null, email: (p.email as string | null) ?? null, dnd: p.dnd === true, timeZone: tzOf(c.locationId), suggestion: null, calledAt: c.at, dollars: dollars.get(`${c.locationId}:${c.contactId}`) ?? 0, callState: c.status,
    };
  }).sort((a, b) => b.dollars - a.dollars || b.calledAt - a.calledAt);
  const night = lostAtNight(rows, (r) => isAfterHours(r.leadAt, r.timeZone), i.now);
  const nightByLoc = new Map<string, number>();
  for (const r of night.lost) nightByLoc.set(r.locationId, (nightByLoc.get(r.locationId) ?? 0) + 1);
  const nightEst = costEstimate(nightByLoc, facts ?? []);
  const nd = await dollarsOf(i.installationId, night.lost.map((r) => `${r.locationId}:${r.contactId}`));
  const owned = new Map<string, number>();
  for (const r of rows) if (r.assignedTo) owned.set(r.assignedTo, (owned.get(r.assignedTo) ?? 0) + 1);
  const repliers = new Set(rows.filter((r) => r.userId).map((r) => r.userId as string));
  const route = routingCheck(owned, repliers);
  const nameOf = (u: string) => resolveUser(u, lk.team, null).label;
  const cover = afterHoursCover(rows, events, tzOf);
  return {
    now: i.now,
    missed: { total: calls.length, recovered15: calls.filter(recoveredIn15).length, unrecovered: unrecovered.length, dollars: missedRows.reduce((s, r) => s + r.dollars, 0), rows: missedRows.slice(0, 50), audit: textBackAudit(calls) },
    night: { lost: night.lost.length, countedDollars: raceMoney(night.lost.map((r) => ({ key: `${r.locationId}:${r.contactId}` })), nd.map).dollars, estimate: nightEst.amount === null ? null : { amount: nightEst.amount, line: money(nightEst.amount) }, hoursToCover: night.hoursToCover.slice(0, 8), afterLeads: cover.afterLeads, answeredSameNight: cover.answeredSameNight, share: cover.share, cover: cover.cover.map((c) => ({ ...c, name: nameOf(c.userId) })) },
    best: bestTimes(events, tzOf), channels: channelMix(events), eventsStored: events.length,
    routing: { ...route, noLeads: route.noLeads.map((u) => ({ userId: u, name: nameOf(u) })), overloaded: route.overloaded.map((u) => ({ userId: u, name: nameOf(u), leads: owned.get(u) ?? 0 })) },
  };
}

async function repliedSet(installationId: string, allowed: string[] | null, rows: readonly { locationId: string; contactId: string; touchAt: number | null }[], now: number) {
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

/** The lead journey for the filtered leads of the last 30 days: counts, drop-off, median time between steps. */
export async function speedJourney(i: Input) {
  const db = sql();
  const o = { targetMinutes: i.targetMinutes, now: i.now };
  const all = await loadRows(db, i.installationId, i.allowed, i.winFrom ?? i.now - 30 * DAY, i.winTo ?? i.now + DAY);
  const ev = await repliedSet(i.installationId, i.allowed, all, i.now);
  const rows = applyFilter(all, i.filter ?? {}, o, ev.channels);
  const oc = await outcomesOf(i.installationId, i.allowed, i.winFrom ?? i.now - 30 * DAY);
  return { now: i.now, steps: journey(rows, oc, ev.replied, ev.first), repliedRecorded: ev.replied !== null };
}
export async function speedJourneyList(i: Input & { step: Step; dropped: boolean }) {
  const db = sql();
  const o = { targetMinutes: i.targetMinutes, now: i.now };
  const [{ lk }, all] = await Promise.all([loadLookups(db, i.installationId, i.allowed, i.targetMinutes, i.now), loadRows(db, i.installationId, i.allowed, i.winFrom ?? i.now - 30 * DAY, i.winTo ?? i.now + DAY)]);
  const ev = await repliedSet(i.installationId, i.allowed, all, i.now);
  const rows = applyFilter(all, i.filter ?? {}, o, ev.channels);
  const oc: Outcomes = await outcomesOf(i.installationId, i.allowed, i.winFrom ?? i.now - 30 * DAY);
  const members = journeyMembers(rows, oc, ev.replied, i.step, i.dropped).sort((a, b) => b.leadAt - a.leadAt);
  const sugg = suggestionsFor(members.slice(0, 100), new Set(members.slice(0, 100).map((r) => r.locationId)));
  return { count: members.length, shown: Math.min(100, members.length), rows: members.slice(0, 100).map((r) => rowOut(r, judge(r, i.targetMinutes, i.now) ?? "waiting", lk, sugg)) };
}
export const isStep = (s: string | null): s is Step => !!s && (STEPS as readonly string[]).includes(s);

/** The printable proof for each account: this month against last month. Facts only; a score needs enough judged leads. */
export async function speedProof(i: Input) {
  const db = sql();
  const [{ lk }, rows] = await Promise.all([loadLookups(db, i.installationId, i.allowed, i.targetMinutes, i.now), loadRows(db, i.installationId, i.allowed, i.now - 60 * DAY, i.now + DAY)]);
  const lines = proofByAccount(rows, (l) => rows.find((r) => r.locationId === l && r.targetMinutes != null)?.targetMinutes ?? i.targetMinutes, i.now);
  // Stage SPEED5: how many of this month's replied leads got a person inside 5 minutes (a plain, printable fact; needs 5 replied leads).
  const quick = new Map<string, { n: number; q: number }>();
  for (const r of rows) {
    if (r.leadAt < i.now - 30 * DAY || r.touchAt === null) continue;
    const c = quick.get(r.locationId) ?? { n: 0, q: 0 }; c.n += 1; if (r.touchAt - r.leadAt <= 300_000) c.q += 1; quick.set(r.locationId, c);
  }
  return { now: i.now, targetMinutes: i.targetMinutes, accounts: lines.map((l) => { const q = quick.get(l.locationId); return { locationId: l.locationId, name: lk.locationNames.get(l.locationId) ?? "Client account", leads: l.leads, now: l.now, before: l.before, within5: q && q.n >= 5 ? { replied: q.n, inside: q.q } : null }; }) };
}

/** One lead, start to finish (lifecycle events, touches by kind, stage, tag and appointment history). The contact must belong to an account the caller may read. */
export async function speedStory(i: Input & { locationId: string; contactId: string }) {
  if (i.allowed && !i.allowed.includes(i.locationId)) return { events: [] };
  return { events: await leadStory(i.installationId, i.locationId, i.contactId) };
}
