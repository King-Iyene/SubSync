// Speed to lead, fourth pass, part two (stage SPEED4): response buckets, advanced filters, the lead journey, the daily rollup and the month-on-month proof. Pure: no database, no React.
import { APP_TZ } from "../design/zone.ts";
import { judge, responseSeconds, sourceLabel } from "./speed-intel.ts";
import type { LoadedRow } from "./speed-parts.ts";
import { localParts, type Outcomes } from "./speed-v3.ts";
import { missedCalls, speedScore, type Score } from "./speed-v4.ts";
import type { Channel, TouchEvent } from "./touch-events.ts";

const median = (v: number[]): number | null => { if (!v.length) return null; const s = [...v].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil(0.5 * s.length) - 1)]; };

export const BUCKETS = ["<1m", "1-5m", "5-15m", "15-60m", "1-4h", "4h+", "none"] as const;
export type Bucket = (typeof BUCKETS)[number];
export function bucketOf(seconds: number | null): Bucket {
  if (seconds === null) return "none";
  return seconds < 60 ? "<1m" : seconds < 300 ? "1-5m" : seconds < 900 ? "5-15m" : seconds < 3600 ? "15-60m" : seconds < 14_400 ? "1-4h" : "4h+";
}

/** Every filter a Speed list or chart accepts. All optional; each narrows. Empty means everything. */
export type LeadFilter = { source?: string; owner?: string; tag?: string; account?: string; hourFrom?: number; hourTo?: number; dow?: number; status?: "within" | "late" | "waiting"; bucket?: Bucket; channel?: Channel; campaign?: string };

/** Parses the filter from a query string (keys f_source, f_owner ...), dropping anything malformed. Never trusted: the route still binds every query to the caller's own accounts. */
export function parseFilter(sp: URLSearchParams): LeadFilter {
  const f: LeadFilter = {};
  const t = (k: string, max = 120) => { const v = sp.get(`f_${k}`); return v && v.length <= max ? v : undefined; };
  const n = (k: string, lo: number, hi: number) => { const v = sp.get(`f_${k}`); if (v === null || v === "") return undefined; const x = Number(v); return Number.isInteger(x) && x >= lo && x <= hi ? x : undefined; };
  const id = (k: string) => { const v = t(k, 64); return v && /^[A-Za-z0-9_-]{3,64}$/.test(v) ? v : undefined; };
  const source = t("source"); if (source) f.source = source;
  const owner = id("owner"); if (owner) f.owner = owner;
  const account = id("account"); if (account) f.account = account;
  const tag = t("tag"); if (tag) f.tag = tag.toLowerCase();
  const campaign = t("campaign"); if (campaign) f.campaign = campaign;
  const hf = n("hourFrom", 0, 23), ht = n("hourTo", 0, 23), dow = n("dow", 0, 6);
  if (hf !== undefined) f.hourFrom = hf;
  if (ht !== undefined) f.hourTo = ht;
  if (dow !== undefined) f.dow = dow;
  const st = sp.get("f_status");
  if (st === "within" || st === "late" || st === "waiting") f.status = st;
  const b = sp.get("f_bucket");
  if (b && (BUCKETS as readonly string[]).includes(b)) f.bucket = b as Bucket;
  const c = sp.get("f_channel");
  if (c && ["sms", "email", "whatsapp", "call", "chat", "other"].includes(c)) f.channel = c as Channel;
  return f;
}
export const filterActive = (f: LeadFilter) => Object.keys(f).length > 0;
export const filterQuery = (f: LeadFilter): Record<string, string> => Object.fromEntries(Object.entries(f).map(([k, v]) => [`f_${k}`, String(v)]));

/** The leads that pass a filter. `channels` (contact key to the channels a person used) only matters for the channel filter. */
export function applyFilter(rows: readonly LoadedRow[], f: LeadFilter, o: { targetMinutes: number; now: number }, channels?: ReadonlyMap<string, ReadonlySet<Channel>>): LoadedRow[] {
  if (!filterActive(f)) return [...rows];
  return rows.filter((r) => {
    if (f.account && r.locationId !== f.account) return false;
    if (f.source && sourceLabel(r.source) !== f.source) return false;
    if (f.owner && r.assignedTo !== f.owner) return false;
    if (f.tag && !(r.tags ?? []).some((x) => x.toLowerCase() === f.tag)) return false;
    if (f.hourFrom !== undefined || f.hourTo !== undefined || f.dow !== undefined) {
      const p = localParts(r.leadAt, r.timeZone);
      if (f.dow !== undefined && p.dow !== f.dow) return false;
      const lo = f.hourFrom ?? 0, hi = f.hourTo ?? 23;
      if (lo <= hi ? !(p.hour >= lo && p.hour <= hi) : !(p.hour >= lo || p.hour <= hi)) return false;
    }
    if (f.status && judge(r, o.targetMinutes, o.now) !== f.status) return false;
    if (f.bucket && bucketOf(responseSeconds(r)) !== f.bucket) return false;
    if (f.channel && !channels?.get(`${r.locationId}:${r.contactId}`)?.has(f.channel)) return false;
    return true;
  });
}

// ---------- the lead journey: arrived, first touch, replied, booked, showed, won. Each step is a subset of the one before, so the drop-off is honest. ----------
export const STEPS = ["arrived", "touched", "replied", "booked", "showed", "won"] as const;
export type Step = (typeof STEPS)[number];
export const STEP_LABEL: Record<Step, string> = { arrived: "Arrived", touched: "First touch", replied: "Replied", booked: "Booked", showed: "Showed", won: "Won" };
export type JourneyStep = { step: Step; label: string; count: number; dropped: number; dropShare: number | null; medianFromPrev: number | null };

/** `replied`: contacts that sent anything back after the first person touch (from the touch events). null when no events are stored yet: a booked, showed or won lead then counts as replied. */
export function journeyReach(r: LoadedRow, oc: Outcomes, replied: ReadonlySet<string> | null): Record<Step, boolean> {
  const key = `${r.locationId}:${r.contactId}`;
  const o = oc.get(key) ?? { booked: false, showed: false, won: false };
  const touched = r.touchAt !== null;
  const rep = touched && ((replied !== null && replied.has(key)) || o.booked || o.showed || o.won);
  const booked = touched && o.booked;
  const showed = booked && o.showed;
  return { arrived: true, touched, replied: rep, booked, showed, won: showed && o.won };
}
export function journey(rows: readonly LoadedRow[], oc: Outcomes, replied: ReadonlySet<string> | null, firstReply?: ReadonlyMap<string, number>): JourneyStep[] {
  const reach = rows.map((r) => ({ r, ok: journeyReach(r, oc, replied) }));
  const out: JourneyStep[] = [];
  let prev = 0;
  STEPS.forEach((step, i) => {
    const hit = reach.filter((x) => x.ok[step]);
    let medianFromPrev: number | null = null;
    if (step === "touched") medianFromPrev = median(hit.map((x) => responseSeconds(x.r)).filter((v): v is number => v !== null));
    if (step === "replied" && firstReply) medianFromPrev = median(hit.map((x) => firstReply.get(`${x.r.locationId}:${x.r.contactId}`)).filter((v): v is number => v !== undefined));
    out.push({ step, label: STEP_LABEL[step], count: hit.length, dropped: i === 0 ? 0 : Math.max(0, prev - hit.length), dropShare: i === 0 || prev === 0 ? null : (prev - hit.length) / prev, medianFromPrev });
    prev = hit.length;
  });
  return out;
}
/** The exact leads at a step (reached it), or those that dropped there (reached the step before, not this one). One function for the counts and the lists. */
export function journeyMembers(rows: readonly LoadedRow[], oc: Outcomes, replied: ReadonlySet<string> | null, step: Step, dropped = false): LoadedRow[] {
  const i = STEPS.indexOf(step);
  return rows.filter((r) => { const ok = journeyReach(r, oc, replied); return dropped ? i > 0 && ok[STEPS[i - 1]] && !ok[step] : ok[step]; });
}

// ---------- the daily rollup row for one account and one day ----------
export type DailyRow = { locationId: string; day: string; leads: number; answered: number; within: number; medianSeconds: number | null; buckets: Record<string, number>; byChannel: Record<string, number>; bySource: Record<string, number>; byOwner: Record<string, number>; byHour: number[]; missedCalls: number; missedFollowed: number; textedBack60: number; failedSends: number };
const dayOf = (ms: number, tz: string | null) => { try { return new Intl.DateTimeFormat("en-CA", { timeZone: tz || APP_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms)); } catch { return new Date(ms).toISOString().slice(0, 10); } };
export function dailyRollup(rows: readonly LoadedRow[], events: readonly TouchEvent[], tzOf: (l: string) => string | null, targetMinutes: number, now: number): DailyRow[] {
  const days = new Map<string, DailyRow>();
  const get = (loc: string, day: string) => {
    const k = `${loc}|${day}`; let d = days.get(k);
    if (!d) { d = { locationId: loc, day, leads: 0, answered: 0, within: 0, medianSeconds: null, buckets: {}, byChannel: {}, bySource: {}, byOwner: {}, byHour: Array(24).fill(0), missedCalls: 0, missedFollowed: 0, textedBack60: 0, failedSends: 0 }; days.set(k, d); }
    return d;
  };
  const secs = new Map<string, number[]>();
  for (const r of rows) {
    const tz = r.timeZone ?? tzOf(r.locationId), day = dayOf(r.leadAt, tz), d = get(r.locationId, day);
    d.leads += 1;
    const s = responseSeconds(r);
    if (s !== null) { d.answered += 1; const k = `${r.locationId}|${day}`; secs.set(k, [...(secs.get(k) ?? []), s]); }
    if (judge(r, targetMinutes, now) === "within") d.within += 1;
    const b = bucketOf(s); d.buckets[b] = (d.buckets[b] ?? 0) + 1;
    const src = sourceLabel(r.source); d.bySource[src] = (d.bySource[src] ?? 0) + 1;
    if (r.assignedTo) d.byOwner[r.assignedTo] = (d.byOwner[r.assignedTo] ?? 0) + 1;
    d.byHour[localParts(r.leadAt, tz).hour] += 1;
  }
  for (const [k, v] of secs) { const d = days.get(k); if (d) d.medianSeconds = median(v); }
  for (const e of events) {
    const d = get(e.locationId, dayOf(e.at, tzOf(e.locationId)));
    if (e.kind === "failed") d.failedSends += 1;
    else if (e.direction === "outbound" && !e.automated) d.byChannel[e.channel] = (d.byChannel[e.channel] ?? 0) + 1;
  }
  for (const m of missedCalls(events, now)) { const d = get(m.locationId, dayOf(m.at, tzOf(m.locationId))); d.missedCalls += 1; if (m.status === "followed") d.missedFollowed += 1; if (m.textedBackSeconds !== null) d.textedBack60 += 1; }
  return [...days.values()];
}

// ---------- agency proof: this month against last month, per account ----------
export type ProofLine = { locationId: string; leads: number; now: Score; before: Score };
export function proofByAccount(rows: readonly LoadedRow[], targetOf: (l: string) => number, now: number, windowDays = 30): ProofLine[] {
  const cut = now - windowDays * 86_400_000, cut2 = now - 2 * windowDays * 86_400_000;
  const by = new Map<string, { a: LoadedRow[]; b: LoadedRow[] }>();
  for (const r of rows) {
    const w = by.get(r.locationId) ?? { a: [], b: [] };
    if (r.leadAt > cut) w.a.push(r); else if (r.leadAt > cut2) w.b.push(r);
    by.set(r.locationId, w);
  }
  return [...by].map(([locationId, w]) => ({ locationId, leads: w.a.length, now: speedScore(w.a, targetOf(locationId), now), before: speedScore(w.b, targetOf(locationId), now) })).sort((x, y) => y.leads - x.leads);
}

/** Lost at night: leads that arrived after hours (or at a weekend) and had no person touch within 12 hours, with the weekday and hours to cover. A cell needs 2 such leads before it counts as an hour to cover. */
export function lostAtNight(rows: readonly LoadedRow[], isAfter: (r: LoadedRow) => boolean, now: number) {
  const lost = rows.filter((r) => isAfter(r) && (r.touchAt === null ? now - r.leadAt > 12 * 3_600_000 : r.touchAt - r.leadAt > 12 * 3_600_000));
  const cells = new Map<string, number>();
  for (const r of lost) { const p = localParts(r.leadAt, r.timeZone); const k = `${p.dow}:${p.hour}`; cells.set(k, (cells.get(k) ?? 0) + 1); }
  const hours = [...cells].filter(([, n]) => n >= 2).map(([k, n]) => { const [dow, hour] = k.split(":").map(Number); return { dow, hour, leads: n }; }).sort((a, b) => b.leads - a.leads);
  return { lost, hoursToCover: hours };
}
