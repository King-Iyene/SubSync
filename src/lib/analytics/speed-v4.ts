// Speed to lead, fourth pass (stage SPEED4). Pure: no database, no React. THE RACE ON NEW LEADS: the clock from arrival to the first person's touch, whether the team is
// winning, and who or what is losing, in money. Every mark and its list come from one function, so a count equals its rows. Definitions: docs/features/SPEED4.md.
import { localParts, isAfterHours } from "./speed-v3.ts";
import { judge, responseSeconds, MIN_FOR_MEDIAN, type TouchRow } from "./speed-intel.ts";
import type { TouchEvent, Channel } from "./touch-events.ts";
import { flagPenalty, leadFlags, type Flag } from "./speed5.ts";

const MIN = 60_000, HOUR = 3_600_000, DAY = 86_400_000;
export const MIN_BUCKET = 5;       // replies needed in one hour of the day before it can be called best
export const MIN_CHANNEL = 20;     // messages sent on a channel before its reply rate is shown
export const FOLLOW_UP_HOURS = 24; // a missed call counts as followed when a person reached out within a day
export const TEXT_BACK_SECONDS = 60;

const median = (v: number[]): number | null => { if (!v.length) return null; const s = [...v].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil(0.5 * s.length) - 1)]; };
const groupByContact = (events: readonly TouchEvent[]) => {
  const m = new Map<string, TouchEvent[]>();
  for (const e of events) { const k = `${e.locationId}:${e.contactId}`; const a = m.get(k); if (a) a.push(e); else m.set(k, [e]); }
  for (const l of m.values()) l.sort((a, b) => a.at - b.at);
  return m;
};

// ---------- the race ----------

export type Race = "winning" | "close" | "losing" | "won" | "lost";
/** Where one lead is in the race: how far through the target it is. `pct` is the share of the target used; `msLeft` is 0 once the target has passed. */
export function raceState(leadAt: number, touchAt: number | null, targetMinutes: number, now: number): { race: Race; pct: number; msLeft: number } {
  const target = targetMinutes * MIN;
  if (touchAt !== null) return { race: touchAt - leadAt <= target ? "won" : "lost", pct: Math.min(1, (touchAt - leadAt) / target), msLeft: 0 };
  const pct = Math.max(0, now - leadAt) / target;
  return { race: pct >= 1 ? "losing" : pct >= 0.6 ? "close" : "winning", pct: Math.min(pct, 9.99), msLeft: Math.max(0, target - Math.max(0, now - leadAt)) };
}

/** The speed score of a set of leads: share answered inside the target (0-100) and the typical first reply. Nothing until MIN_FOR_MEDIAN leads are judged: never a score on a handful. */
export type Score = { judged: number; within: number; score: number | null; medianSeconds: number | null; enough: boolean };
export function speedScore(rows: readonly TouchRow[], targetMinutes: number, now: number): Score {
  let judged = 0, within = 0; const secs: number[] = [];
  for (const r of rows) {
    const j = judge(r, targetMinutes, now); if (!j) continue;
    judged += 1; if (j === "within") within += 1;
    const s = responseSeconds(r); if (s !== null) secs.push(s);
  }
  const enough = judged >= MIN_FOR_MEDIAN;
  return { judged, within, score: enough ? Math.round((within / judged) * 100) : null, medianSeconds: enough ? median(secs) : null, enough };
}

/** Lead quality 0-100 from what the lead gave us (a phone, an email that looks real, a source we know). A starting guess for who to call first, labelled as such. */
export function leadQuality(l: { phone?: string | null; email?: string | null; source?: string | null }): { score: number; parts: string[]; flags: Flag[] } {
  let score = 0; const parts: string[] = [];
  const digits = (l.phone ?? "").replace(/\D/g, "");
  if (digits.length >= 10 && digits.length <= 15 && !/^(\d)\1+$/.test(digits)) { score += 45; parts.push("phone"); }
  const e = (l.email ?? "").trim().toLowerCase();
  if (/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(e) && !/^(test|none|noemail|asdf)@|@(test|example|mailinator)\./.test(e)) { score += 35; parts.push("email"); }
  const s = (l.source ?? "").trim();
  if (s && !/^(unknown|none|other|no source)/i.test(s)) { score += 20; parts.push("source"); }
  // Stage SPEED5: validity at capture. A throwaway or shared-mailbox email and a made-up phone only lower the guess, quietly; they never hide the lead.
  const flags = leadFlags(l);
  return { score: Math.max(0, score - flagPenalty(flags)), parts, flags };
}

// ---------- coverage, from the touch events ----------

export type MissedCall = { locationId: string; contactId: string; at: number; followedAt: number | null; textedBackSeconds: number | null; firstOutboundSeconds: number | null; status: "open" | "followed" | "dropped" };
/** recovered in 15 minutes: any outbound touch (a person or a workflow text) within 15 minutes. */
export const recoveredIn15 = (c: Pick<MissedCall, "firstOutboundSeconds">) => c.firstOutboundSeconds !== null && c.firstOutboundSeconds <= 900;
/** Every missed call and what happened next. followed: a person or a workflow reached out within a day. dropped: nobody did and the day is over. open: nobody yet, still inside the day. */
export function missedCalls(events: readonly TouchEvent[], now: number): MissedCall[] {
  const out: MissedCall[] = [];
  for (const list of groupByContact(events).values()) {
    for (const m of list) {
      if (m.kind !== "missed_call") continue;
      const next = list.find((e) => e.direction === "outbound" && e.kind !== "failed" && !e.automated && e.at >= m.at && e.at - m.at <= FOLLOW_UP_HOURS * HOUR);
      const anyOut = list.find((e) => e.direction === "outbound" && e.kind !== "failed" && e.at >= m.at && e.at - m.at <= FOLLOW_UP_HOURS * HOUR);
      const text = list.find((e) => e.direction === "outbound" && e.kind !== "failed" && (e.channel === "sms" || e.channel === "whatsapp") && e.at >= m.at && e.at - m.at <= TEXT_BACK_SECONDS * 1000);
      out.push({ locationId: m.locationId, contactId: m.contactId, at: m.at, followedAt: next?.at ?? null, textedBackSeconds: text ? Math.round((text.at - m.at) / 1000) : null, firstOutboundSeconds: anyOut ? Math.round((anyOut.at - m.at) / 1000) : null, status: next ? "followed" : now - m.at > FOLLOW_UP_HOURS * HOUR ? "dropped" : "open" });
    }
  }
  return out.sort((a, b) => b.at - a.at);
}
/** From the stored calls (pure, tested) or from the SQL counts of missedStats (missed-calls.ts), which is what the screens use. */
export function textBackAudit(calls: readonly MissedCall[] | { calls: number; texted60: number }) {
  const list = Array.isArray(calls) ? (calls as readonly MissedCall[]) : null;
  const n = list ? list.length : (calls as { calls: number }).calls, texted = list ? list.filter((c) => c.textedBackSeconds !== null).length : (calls as { texted60: number }).texted60;
  return { missed: n, textedWithin60: texted, share: n >= MIN_BUCKET ? Math.round((texted / n) * 100) : null, enough: n >= MIN_BUCKET };
}

export type HourBest = { hour: number; sent: number; replied: number; rate: number | null };
/** When do leads answer? A person's outbound message or call is a "try"; it is "answered" when the same contact sends anything back within 24 hours. Rate by hour of the day in the account's own zone. */
export function bestTimes(events: readonly TouchEvent[], tzOf: (locationId: string) => string | null) {
  const cells = new Map<number, { sent: number; replied: number; hour: number }>();
  let tries = 0;
  for (const list of groupByContact(events).values()) {
    for (const e of list) {
      if (e.direction !== "outbound" || e.automated || e.kind === "failed") continue;
      const hour = localParts(e.at, tzOf(e.locationId)).hour;
      const c = cells.get(hour) ?? { sent: 0, replied: 0, hour };
      c.sent += 1; tries += 1;
      if (list.some((x) => x.direction === "inbound" && x.at > e.at && x.at - e.at <= DAY)) c.replied += 1;
      cells.set(hour, c);
    }
  }
  const hours: HourBest[] = [...cells.values()].map((c) => ({ ...c, rate: c.sent >= MIN_BUCKET * 2 ? c.replied / c.sent : null })).sort((a, b) => a.hour - b.hour);
  const best = hours.filter((h) => h.rate !== null && h.replied >= MIN_BUCKET).sort((a, b) => (b.rate as number) - (a.rate as number) || b.sent - a.sent).slice(0, 3);
  return { hours, best, enough: best.length > 0, tries };
}

export type ChannelRow = { channel: Channel; sent: number; replied: number; rate: number | null; failed: number; failedRate: number | null; winner: boolean };
/** Channel mix: what people sent, how many got an answer within a day, how many failed to deliver. A winner only when at least two channels have MIN_CHANNEL sends. */
export function channelMix(events: readonly TouchEvent[]): ChannelRow[] {
  const agg = new Map<Channel, { sent: number; replied: number; failed: number }>();
  for (const list of groupByContact(events).values()) {
    for (const e of list) {
      if (e.direction !== "outbound" || e.automated) continue;
      const a = agg.get(e.channel) ?? { sent: 0, replied: 0, failed: 0 };
      if (e.kind === "failed") a.failed += 1;
      else { a.sent += 1; if (list.some((x) => x.direction === "inbound" && x.at > e.at && x.at - e.at <= DAY)) a.replied += 1; }
      agg.set(e.channel, a);
    }
  }
  const rows: ChannelRow[] = [...agg].map(([channel, a]) => ({ channel, sent: a.sent, replied: a.replied, rate: a.sent >= MIN_CHANNEL ? a.replied / a.sent : null, failed: a.failed, failedRate: a.sent + a.failed >= MIN_CHANNEL ? a.failed / (a.sent + a.failed) : null, winner: false }));
  const eligible = rows.filter((r) => r.rate !== null);
  if (eligible.length >= 2) { const top = eligible.reduce((a, b) => ((b.rate as number) > (a.rate as number) ? b : a)); top.winner = true; }
  return rows.sort((a, b) => b.sent - a.sent);
}

/** After hours: leads that arrived outside business hours, how many got a person's reply within 12 hours, and who has replied after hours before (could cover). */
export function afterHoursCover(rows: readonly TouchRow[], events: readonly TouchEvent[], tzOf: (l: string) => string | null) {
  const after = rows.filter((r) => isAfterHours(r.leadAt, tzOf(r.locationId)));
  const answered = after.filter((r) => r.touchAt !== null && r.touchAt - r.leadAt <= 12 * HOUR).length;
  const who = new Map<string, number>();
  for (const e of events) if (e.direction === "outbound" && !e.automated && e.userId && isAfterHours(e.at, tzOf(e.locationId))) who.set(e.userId, (who.get(e.userId) ?? 0) + 1);
  const cover = [...who].filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([userId, touches]) => ({ userId, touches }));
  return { afterLeads: after.length, answeredSameNight: answered, share: after.length >= MIN_BUCKET ? Math.round((answered / after.length) * 100) : null, cover };
}

/** Round robin sanity: people who send replies but were given no leads, and whoever holds more than twice an even share. Needs at least 10 owned leads. */
export function routingCheck(owned: ReadonlyMap<string, number>, repliers: ReadonlySet<string>) {
  const total = [...owned.values()].reduce((a, b) => a + b, 0);
  const people = new Set([...owned.keys(), ...repliers]);
  if (total < 10 || people.size < 2) return { enough: false, noLeads: [] as string[], overloaded: [] as string[], fair: null as number | null };
  const fair = total / people.size;
  return { enough: true, fair, noLeads: [...repliers].filter((u) => !owned.get(u)), overloaded: [...owned].filter(([, n]) => n > fair * 2).map(([u]) => u) };
}

/** Money of the race: the open-deal dollars of the leads past their target, as counted deals (a fact, not an estimate). */
export function raceMoney(losing: ReadonlyArray<{ key: string }>, dollars: ReadonlyMap<string, number>) {
  let sum = 0, withDeals = 0;
  for (const l of losing) { const d = dollars.get(l.key) ?? 0; if (d > 0) { sum += d; withDeals += 1; } }
  return { dollars: sum, withDeals };
}
