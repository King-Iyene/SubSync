import { sql } from "../db";
import type { AlertDraft } from "./derive";
import type { Person } from "./dedupe";
import { resolveUser } from "./people-labels";
import { loadLookups, loadRows, loadTargets } from "./speed-queries";
import { bookingFromCounts } from "./speed5";
import { bookingSql, holdersSql } from "./speed-sql-cards";
import type { Scope } from "./speed-sql";
import { accountFacts } from "./speed-v2-queries";
import { DAY } from "./speed-v3";
import { duplicateOf, escalate, minutesToNextStep, moneyAtRisk, normLadder, repeatBoost, roundRobinPick, DEFAULT_LADDER, STEP_WORDS, type Candidate, type DupHit, type Ladder, type WaitingLead,
} from "./speed5";
import type { Input } from "./speed-v4-queries";

// The reads behind SPEED5. Read only, except saveLadder (one small setting, typed by the person). Every query is bound to the accounts the router allowed.
// A database without the new column (the migration has not run) answers the default ladder and says so; nothing here stops the screen or the alert run.

// ---------------------------------------------------------------- the ladder setting

export async function loadLadder(installationId: string): Promise<{ ready: boolean; ladder: Ladder }> {
  try {
    const [r] = await sql()`select speed_escalation from settings where installation_id = ${installationId}`;
    return { ready: true, ladder: normLadder(r?.speed_escalation) };
  } catch {
    return { ready: false, ladder: DEFAULT_LADDER };
  }
}

export async function saveLadder(installationId: string, raw: unknown): Promise<{ ok: true; ladder: Ladder } | { ok: false; error: string }> {
  const ladder = normLadder(raw);
  try {
    await sql()`update settings set speed_escalation = ${JSON.stringify(ladder)}::text::jsonb where installation_id = ${installationId}`;
    return { ok: true, ladder };
  } catch {
    return { ok: false, error: "Saving this needs the latest database update. Ask the person who runs SubSync to apply it." };
  }
}

// ---------------------------------------------------------------- breach alerts that respect each account's own target

/**
 * New leads waiting past EACH account's own reply target (the account's number when it set one, else `defaultMinutes`), last 2 days, with the oldest wait. The clock is `clock_start`,
 * which already applies business hours (in each account's own time zone) when that setting is on. Null when the database cannot answer; the caller then keeps the default-target numbers.
 */
export async function perAccountBreaches(installationId: string, defaultMinutes: number): Promise<Map<string, { waiting: number; oldestWaitMinutes: number | null; targetMinutes: number }> | null> {
  try {
    const rows = await sql()`
      select t.location_id, coalesce(l.speed_target_minutes, ${defaultMinutes}::int)::int target,
        count(*) filter (where t.touch_at is null and coalesce(t.clock_start, t.lead_at) < now() - make_interval(mins => coalesce(l.speed_target_minutes, ${defaultMinutes}::int)) and t.lead_at > now() - interval '2 days')::int waiting,
        extract(epoch from now() - min(coalesce(t.clock_start, t.lead_at)) filter (where t.touch_at is null and coalesce(t.clock_start, t.lead_at) < now() - make_interval(mins => coalesce(l.speed_target_minutes, ${defaultMinutes}::int)) and t.lead_at > now() - interval '2 days')) / 60 oldest
      from lead_touches t join locations l on l.installation_id = t.installation_id and l.location_id = t.location_id
      where t.installation_id = ${installationId} and t.excluded is null group by t.location_id, l.speed_target_minutes`;
    return new Map(rows.map((r) => [r.location_id as string, { waiting: Number(r.waiting), oldestWaitMinutes: r.oldest === null ? null : Math.round(Number(r.oldest)), targetMinutes: Number(r.target) }]));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- booking by first-reply time

const BOOK_WINDOW_DAYS = 14;
/** The money chart. Leads from 90 days ago to yesterday (so a booking has had time to happen). Booked = an appointment that was not cancelled, made for the contact after the lead arrived and within 14 days. Counted in the database per reply bucket. */
export async function speedBooking(i: Input, known?: { targetsReady: boolean }) {
  const db = sql();
  const targets = known ?? { ready: (await loadTargets(db, i.installationId)).ready };
  const s: Scope = { installationId: i.installationId, allowed: i.allowed, targetMinutes: i.targetMinutes, now: i.now, fromMs: i.winFrom ?? i.now - 90 * DAY, toMs: Math.min(i.winTo ?? i.now, i.now - DAY), targetsReady: "targetsReady" in targets ? targets.targetsReady : targets.ready };
  const r = await bookingSql(db, s).catch(() => null);
  const { appointmentsRecorded, ...rest } = r ?? { ...bookingFromCounts(new Map()), appointmentsRecorded: false };
  return { now: i.now, days: 90, bookWithinDays: BOOK_WINDOW_DAYS, appointmentsRecorded, ...rest };
}

// ---------------------------------------------------------------- the duplicate guard and the repeat enquirer

type Key = string;
const ph = (p: string | null) => (p ?? "").replace(/\D/g, "").slice(-10);

/** For each lead of the feed: an older record of the same person in the same account (Clean-up match engine, read only), and whether this looks like a repeat enquiry. */
export async function duplicateGuard(installationId: string, allowed: string[] | null, leads: ReadonlyArray<{ locationId: string; contactId: string; name: string; email: string | null; phone: string | null; leadAt: number }>): Promise<Map<Key, DupHit>> {
  const out = new Map<Key, DupHit>();
  const usable = leads.filter((l) => (l.email && l.email.includes("@")) || ph(l.phone).length >= 7).slice(0, 80);
  if (usable.length === 0) return out;
  const db = sql();
  const emails = [...new Set(usable.map((l) => (l.email ?? "").trim().toLowerCase()).filter(Boolean))];
  const phones = [...new Set(usable.map((l) => ph(l.phone)).filter((p) => p.length >= 7))];
  const cands = await db`
    select location_id, contact_id, full_name, email, phone, tags, date_added, last_activity_at, source from cached_contacts
    where installation_id = ${installationId} ${allowed ? db`and location_id = any(${allowed}::text[])` : db``}
      and (lower(email) = any(${emails}::text[]) or (phone_digits is not null and right(phone_digits, 10) = any(${phones}::text[])))
    limit 2000`.catch(() => []);
  const byLoc = new Map<string, Person[]>();
  for (const c of cands) {
    const p: Person = { contactId: c.contact_id as string, name: (c.full_name as string) || "Unnamed contact", email: (c.email as string | null) ?? null, phone: (c.phone as string | null) ?? null, tags: (c.tags as string[] | null) ?? [], createdAt: c.date_added ? new Date(c.date_added as string).toISOString() : null, lastActivityAt: null, source: (c.source as string | null) ?? null, openDeals: 0, wonDeals: 0, hasConversation: false };
    const arr = byLoc.get(c.location_id as string) ?? []; arr.push(p); byLoc.set(c.location_id as string, arr);
  }
  for (const l of usable) {
    const me: Person = { contactId: l.contactId, name: l.name, email: l.email, phone: l.phone, tags: [], createdAt: new Date(l.leadAt).toISOString(), lastActivityAt: null, source: null, openDeals: 0, wonDeals: 0, hasConversation: false };
    const hit = duplicateOf(me, byLoc.get(l.locationId) ?? []);
    if (hit) out.set(`${l.locationId}:${l.contactId}`, hit);
  }
  return out;
}

// ---------------------------------------------------------------- Race extras: money meter, round-robin, duplicates

/** What the Race tab adds: the money-at-risk meter and, per feed row, the duplicate hit, the repeat boost and the round-robin suggestion for a lead nobody owns. */
export async function raceExtras(i: Input, feed: ReadonlyArray<{ locationId: string; contactId: string; name: string; email: string | null; phone: string | null; arrivedAt: number; touchedAt: number | null; unassigned: boolean; dollars: number }>, openDollars: number, pre?: { lk: Awaited<ReturnType<typeof loadLookups>>["lk"]; facts: Awaited<ReturnType<typeof accountFacts>>; targetsReady: boolean }) {
  const db = sql();
  const ready = pre ? pre.targetsReady : (await loadTargets(db, i.installationId)).ready;
  const s: Scope = { installationId: i.installationId, allowed: i.allowed, targetMinutes: i.targetMinutes, now: i.now, fromMs: i.now - 30 * DAY, toMs: i.now + DAY, targetsReady: ready };
  const rrLocs = [...new Set(feed.filter((f) => f.unassigned && f.touchedAt === null).map((f) => f.locationId))];
  const [{ lk }, facts, book, dups, holders] = await Promise.all([
    pre ? Promise.resolve({ lk: pre.lk }) : loadLookups(db, i.installationId, i.allowed, i.targetMinutes, i.now),
    pre ? Promise.resolve(pre.facts) : accountFacts(i.installationId, i.allowed), speedBooking(i, { targetsReady: ready }), duplicateGuard(i.installationId, i.allowed, feed.map((f) => ({ ...f, leadAt: f.arrivedAt }))), holdersSql(db, s, rrLocs),
  ]);
  // Round-robin per account: among the people who replied in the last 30 days, the one holding the fewest leads still waiting.
  const rr = new Map<string, string | null>();
  for (const loc of rrLocs) rr.set(loc, roundRobinPick(holders.filter((h) => h.loc === loc).map((h): Candidate => ({ userId: h.userId, open: h.open, recent: h.recent }))));
  const waiting = feed.filter((f) => f.touchedAt === null).length;
  const avgDeals = (facts ?? []).map((f) => f.avgDealValue).filter((v): v is number => typeof v === "number" && v > 0);
  const avgDeal = avgDeals.length ? avgDeals.reduce((s, v) => s + v, 0) / avgDeals.length : null;
  const meter = moneyAtRisk({ waiting, fastRate: book.fastRate, slowRate: book.slowRate, avgDeal, openDealDollars: openDollars });
  const byKey = new Map<string, { dup: (DupHit & { locationId: string }) | null; boost: number; roundRobin: { userId: string; label: string } | null }>();
  for (const f of feed) {
    const k = `${f.locationId}:${f.contactId}`;
    const dup = dups.get(k) ?? null;
    const u = f.unassigned && f.touchedAt === null ? rr.get(f.locationId) ?? null : null;
    byKey.set(k, { dup: dup ? { ...dup, locationId: f.locationId } : null, boost: repeatBoost(dup), roundRobin: u ? { userId: u, label: resolveUser(u, lk.team, lk.usersAccess.get(f.locationId)).label } : null });
  }
  return { meter: { ...meter, waiting, bookingGapKnown: book.multiple !== null, multiple: book.multiple, estimateNote: meter.estimate === null ? "Needs 10 or more leads answered fast and 10 answered slowly, plus the account's average deal." : null }, byKey };
}

// ---------------------------------------------------------------- the ladder, live (Rules tab preview)

/** Every account's target and what the alert would say right now, plus the waiting leads with the step each has reached and who is told. Nothing is sent: this is the preview of a dry run. */
export async function ladderPreview(i: Input) {
  const db = sql();
  const [{ lk, locs }, rows, { ready, ladder }] = await Promise.all([loadLookups(db, i.installationId, i.allowed, i.targetMinutes, i.now), loadRows(db, i.installationId, i.allowed, i.now - 2 * DAY, i.now + DAY), loadLadder(i.installationId)]);
  const waitingRows = rows.filter((r) => r.touchAt === null);
  const lead = (r: (typeof rows)[number]): WaitingLead => ({ locationId: r.locationId, contactId: r.contactId, waitedMin: (i.now - r.leadAt) / 60_000, targetMin: r.targetMinutes ?? i.targetMinutes, ownerId: r.assignedTo });
  const { leads, topByAccount } = escalate(waitingRows.map(lead), ladder);
  const nameOf = (loc: string, u: string | null) => (u ? resolveUser(u, lk.team, lk.usersAccess.get(loc)).label : null);
  const byKey = new Map(waitingRows.map((r) => [`${r.locationId}:${r.contactId}`, r]));
  const nextPerson = (loc: string, owner: string | null) => {
    const mine = rows.filter((r) => r.locationId === loc);
    const people = new Set(mine.filter((r) => r.userId).map((r) => r.userId as string));
    return roundRobinPick([...people].map((u) => ({ userId: u, open: mine.filter((r) => r.assignedTo === u && r.touchAt === null).length, recent: mine.filter((r) => r.assignedTo === u).length })), new Set(owner ? [owner] : []));
  };
  const accounts = locs.map((l) => {
    const loc = l.location_id as string;
    const target = rows.find((r) => r.locationId === loc && r.targetMinutes != null)?.targetMinutes ?? i.targetMinutes;
    const mine = leads.filter((x) => x.locationId === loc);
    const top = topByAccount.get(loc) ?? 0;
    return {
      locationId: loc, name: lk.locationNames.get(loc) ?? "Client account", targetMinutes: target, waiting: mine.length, topStep: top,
      wouldSay: mine.length === 0 ? null : `${lk.locationNames.get(loc) ?? "Client account"}: ${mine.length} new ${mine.length === 1 ? "lead has" : "leads have"} waited more than ${target} minutes for a reply (${STEP_WORDS[top as 1 | 2 | 3]}).`,
    };
  }).sort((a, b) => b.topStep - a.topStep || b.waiting - a.waiting);
  const list = leads.sort((a, b) => b.step - a.step || b.waitedMin - a.waitedMin).slice(0, 25).map((l) => {
    const r = byKey.get(`${l.locationId}:${l.contactId}`);
    const nxt = nextPerson(l.locationId, l.ownerId);
    return {
      locationId: l.locationId, contactId: l.contactId, name: r?.name ?? "Lead", account: lk.locationNames.get(l.locationId) ?? "Client account", waitedMin: Math.round(l.waitedMin), targetMin: l.targetMin, step: l.step, stepWords: STEP_WORDS[l.step],
      owner: nameOf(l.locationId, l.ownerId), nextPerson: nameOf(l.locationId, nxt), toNext: minutesToNextStep(l.waitedMin, l.targetMin, ladder),
    };
  });
  return { now: i.now, ladderReady: ready, ladder, accounts: accounts.slice(0, 40), leads: list, note: "Dry run: nothing is sent from this page. Real alerts follow the alert switches in Settings." };
}

// ---------------------------------------------------------------- the new-lead duplicate alert (bell, dry run)

/** One info alert per account when 2 or more NEW leads of the last 24 hours look like people already in the account. Rebuilt on every refresh, so it clears itself. */
export async function newLeadDuplicateDrafts(installationId: string, now = Date.now()): Promise<AlertDraft[]> {
  const rows = await loadRows(sql(), installationId, null, now - DAY, now + DAY).catch(() => []);
  if (rows.length === 0) return [];
  const hits = await duplicateGuard(installationId, null, rows.slice(0, 80).map((r) => ({ locationId: r.locationId, contactId: r.contactId, name: r.name, email: r.email ?? null, phone: r.phone ?? null, leadAt: r.leadAt })));
  const per = new Map<string, number>();
  for (const k of hits.keys()) { const loc = k.slice(0, k.indexOf(":")); per.set(loc, (per.get(loc) ?? 0) + 1); }
  const names = await sql()`select location_id, name from locations where installation_id = ${installationId}`.catch(() => []);
  const nm = new Map(names.map((n) => [n.location_id as string, (n.name as string | null) ?? "A client account"]));
  return [...per.entries()].filter(([, n]) => n >= 2).map(([loc, n]) => ({
    dedupeKey: `leaddup:${loc}`, kind: "duplicates", severity: "info" as const, locationId: loc,
    title: `${nm.get(loc)}: ${n} new leads look like people already in the account`, detail: { newLeadDuplicates: n },
  }));
}


/** Puts each account's own target and its own waiting count on the account rows, and reads the ladder. If the per-account read fails the rows are returned unchanged (default target). */
export async function applyBreaches<T extends { locationId: string; speedWaiting?: number; oldestWaitMinutes?: number | null; speedTargetMinutes?: number | null }>(installationId: string, accounts: T[], defaultMinutes: number): Promise<{ accounts: T[]; ladder: Ladder }> {
  const [map, { ladder }] = await Promise.all([perAccountBreaches(installationId, defaultMinutes), loadLadder(installationId)]);
  if (!map) return { accounts, ladder };
  return { accounts: accounts.map((a) => { const b = map.get(a.locationId); return b ? { ...a, speedWaiting: b.waiting, oldestWaitMinutes: b.oldestWaitMinutes, speedTargetMinutes: b.targetMinutes } : a; }), ladder };
}
