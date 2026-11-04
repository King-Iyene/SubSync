// The "smart" part of Today: insights, the 24-hour coverage strip, speed by source, workload by person, accounts compared, the best next action and the plain
// countdown of what will go wrong if nobody acts. Pure, and every rule is written in docs/METRICS.md ("Today, second pass") and unit tested.
//
// Ground rules, the same everywhere in this file:
//   - Only data SubSync already holds: the lead ledger (lead_touches of the last 14 days, the same rows and exclusions as Speed to lead) and Today's own items.
//   - A median or a comparison is shown only above the minimum sample SubSync already uses (MIN_FOR_MEDIAN replies for a median, MIN_PER_PERSON for a person).
//   - A comparison is an ESTIMATE and says so. Counts of things (leads with no reply, no-shows) are facts.
//   - Nothing here claims a cause. It says what is different and how many leads it is based on.
//   - Nothing here writes anywhere or sends anything.

import { judge, MIN_FOR_MEDIAN, MIN_PER_PERSON, NEVER_ANSWERED_MINUTES, NO_SOURCE, sourceLabel, type Judged } from "./speed-intel.ts";
import { localClock } from "./digest-intel.ts";
import type { LedgerLead, Rec, RecordsSpec } from "./today-records.ts";
import { leadsSpec, trimColumns } from "./today-records.ts";
import { ageWords, KIND_LABEL, money, replyWords, type Kind, type QueueRow, type TodayItem } from "./today-queue.ts";

const DAY = 86_400_000;
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.max(0, Math.ceil(0.5 * s.length) - 1))]; };

/** One lead of the last 14 days, as the ledger holds it. `zone` is the client account's own time zone, so "6 pm" means 6 pm there. */
export type LeadRow = LedgerLead & { zone: string };

const replySeconds = (r: Pick<LeadRow, "leadAt" | "touchAt">): number | null => (r.touchAt === null ? null : Math.max(0, Math.round((r.touchAt - r.leadAt) / 1000)));
export const hourOf = (ms: number, zone: string): number => localClock(new Date(ms), zone)?.hour ?? localClock(new Date(ms), "UTC")?.hour ?? 0;
const plural = (n: number, one: string, many = one + "s") => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
export const hourWords = (h: number) => `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? "am" : "pm"}`;

// ---------- insights: "Spotted today" ----------

export const AFTER_HOURS_FROM = 18;
export const DAY_FROM = 8;
export const SLOW_RATIO = 2;
export const NO_REPLY_DAYS = 3;
export const MIN_NO_REPLY = 5;
export const MIN_NOSHOWS = 3;
export const MAX_INSIGHTS = 3;

export type InsightKey = "idle_owner" | "noshows" | "slow_after_hours" | "slow_source";
export type Insight = {
  key: InsightKey; text: string;
  /** How many leads, appointments or deals the sentence is based on: the number in the card, and the number of rows it opens. */
  sample: number; sampleLabel: string;
  /** A comparison or a typical value is an estimate and the card says so; a plain count is a fact. */
  estimate: boolean;
  title: string; subtitle: string;
  /** The leads behind a lead-based insight (the ledger rows, capped), or the ids of Today's items behind a count. */
  leads?: LedgerLead[]; itemIds?: string[];
};
const CARD_ROWS = 100;
const stripZone = (l: LeadRow): LedgerLead => { const { zone: _z, ...rest } = l; void _z; return rest; };

/** "Replies are 2.4x slower than usual after 6 pm (31 leads)": leads that arrived from 6 pm to 8 am against the leads of the day, both groups at least MIN_FOR_MEDIAN answered. */
export function insightAfterHours(rows: LeadRow[]): Insight | null {
  const answered = rows.filter((r) => r.touchAt !== null);
  const night = answered.filter((r) => { const h = hourOf(r.leadAt, r.zone); return h >= AFTER_HOURS_FROM || h < DAY_FROM; });
  const day = answered.filter((r) => { const h = hourOf(r.leadAt, r.zone); return h >= DAY_FROM && h < AFTER_HOURS_FROM; });
  if (night.length < MIN_FOR_MEDIAN || day.length < MIN_FOR_MEDIAN) return null;
  const n = median(night.map((r) => replySeconds(r) as number)), d = median(day.map((r) => replySeconds(r) as number));
  if (d <= 0 || n - d < 60 || n / d < SLOW_RATIO) return null;
  const x = Math.round((n / d) * 10) / 10;
  return {
    key: "slow_after_hours", estimate: true, sample: night.length, sampleLabel: plural(night.length, "lead"),
    text: `Replies are ${x}x slower than usual for leads that arrive after ${hourWords(AFTER_HOURS_FROM)}: ${replyWords(n)} against ${replyWords(d)} in the day.`,
    title: `Leads that arrived after ${hourWords(AFTER_HOURS_FROM)} and before ${hourWords(DAY_FROM)}`, subtitle: `The ${night.length} answered leads of the last 14 days behind the comparison. Typical first reply ${replyWords(n)}, against ${replyWords(d)} for ${day.length} leads in the day. An estimate; it does not say why.`,
    leads: night.slice(0, CARD_ROWS).map(stripZone),
  };
}

/** "Facebook leads wait 3x longer than Google leads": the slowest source against the fastest, each with at least MIN_FOR_MEDIAN answered leads. */
export function insightSource(rows: LeadRow[]): Insight | null {
  const by = new Map<string, LeadRow[]>();
  for (const r of rows) {
    if (r.touchAt === null) continue;
    const k = sourceLabel(r.source);
    if (k === NO_SOURCE) continue;
    by.set(k.toLowerCase(), [...(by.get(k.toLowerCase()) ?? []), r]);
  }
  const groups = [...by.values()].filter((g) => g.length >= MIN_FOR_MEDIAN).map((g) => ({ name: sourceLabel(g[0].source), rows: g, m: median(g.map((r) => replySeconds(r) as number)) }));
  if (groups.length < 2) return null;
  groups.sort((a, b) => a.m - b.m);
  const fast = groups[0], slow = groups[groups.length - 1];
  if (fast.m <= 0 || slow.m - fast.m < 60 || slow.m / fast.m < SLOW_RATIO) return null;
  const x = Math.round((slow.m / fast.m) * 10) / 10;
  return {
    key: "slow_source", estimate: true, sample: slow.rows.length, sampleLabel: plural(slow.rows.length, "lead"),
    text: `${slow.name} leads wait ${x}x longer than ${fast.name} leads for a first reply (${replyWords(slow.m)} against ${replyWords(fast.m)}).`,
    title: `${slow.name} leads, last 14 days`, subtitle: `The ${slow.rows.length} answered ${slow.name} leads behind the comparison. ${fast.name}: ${fast.rows.length} answered leads, typical first reply ${replyWords(fast.m)}. An estimate; it does not say why.`,
    leads: slow.rows.slice(0, CARD_ROWS).map(stripZone),
  };
}

/** "Marcus has 11 leads with no reply for 3 days": the owner with the most leads nobody has replied to for at least NO_REPLY_DAYS (a count, so a fact). */
export function insightIdleOwner(rows: LeadRow[], now: number): Insight | null {
  const by = new Map<string, LeadRow[]>();
  for (const r of rows) {
    if (r.touchAt !== null || !r.ownerName || now - r.leadAt < NO_REPLY_DAYS * DAY) continue;
    by.set(r.ownerName, [...(by.get(r.ownerName) ?? []), r]);
  }
  const top = [...by.entries()].filter(([, g]) => g.length >= MIN_NO_REPLY).sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))[0];
  if (!top) return null;
  const [name, g] = top;
  return {
    key: "idle_owner", estimate: false, sample: g.length, sampleLabel: plural(g.length, "lead"),
    text: `${name} has ${plural(g.length, "lead")} with no reply for ${NO_REPLY_DAYS} days or more.`,
    title: `${name}, leads with no reply for ${NO_REPLY_DAYS}+ days`, subtitle: `Leads that ${name} owns in the CRM, that arrived at least ${NO_REPLY_DAYS} days ago, and that nobody has replied to.`,
    leads: g.sort((a, b) => a.leadAt - b.leadAt).slice(0, CARD_ROWS).map(stripZone),
  };
}

/** "Bright Smile Dental has 5 no-shows nobody rebooked": the account with the most no-shows still to recover (at least MIN_NOSHOWS). Worked out from the items on screen, so a row set aside is not counted. */
export function insightNoShows(items: TodayItem[]): Insight | null {
  const by = new Map<string, TodayItem[]>();
  for (const i of items) if (i.kind === "noshows") by.set(i.locationId, [...(by.get(i.locationId) ?? []), i]);
  const top = [...by.values()].filter((g) => g.length >= MIN_NOSHOWS).sort((a, b) => b.length - a.length || a[0].accountName.localeCompare(b[0].accountName))[0];
  if (!top) return null;
  return {
    key: "noshows", estimate: false, sample: top.length, sampleLabel: plural(top.length, "no-show"),
    text: `${top[0].accountName} has ${plural(top.length, "no-show")} nobody rebooked.`,
    title: `${top[0].accountName}, no-shows to recover`, subtitle: "No-shows from the last 14 days with no later appointment booked for the same person.",
    itemIds: top.map((i) => i.id),
  };
}

/** At most three cards, in a fixed order (facts before estimates), each above its minimum sample. */
export function pickInsights(leadBased: Insight[], items: TodayItem[]): Insight[] {
  const noshows = insightNoShows(items);
  const order: InsightKey[] = ["idle_owner", "noshows", "slow_after_hours", "slow_source"];
  const all = [...leadBased, ...(noshows ? [noshows] : [])];
  return order.map((k) => all.find((i) => i.key === k)).filter((x): x is Insight => !!x).slice(0, MAX_INSIGHTS);
}
export const leadInsights = (rows: LeadRow[], now: number): Insight[] =>
  [insightIdleOwner(rows, now), insightAfterHours(rows), insightSource(rows)].filter((x): x is Insight => !!x);

// ---------- the 24-hour coverage strip ----------

export type HourStat = { hour: number; leads: number; within: number; missed: number; gap: boolean };
export const GAP_SHARE = 0.5;
/** For each local hour, the judged leads that arrived in it (answered inside the target, or answered late or still waiting). An hour is a gap when it has at least MIN_FOR_MEDIAN leads and fewer than half were answered inside the target. */
export function hourStats(rows: LeadRow[], targetMinutes: number, now: number): HourStat[] {
  const out: HourStat[] = Array.from({ length: 24 }, (_, hour) => ({ hour, leads: 0, within: 0, missed: 0, gap: false }));
  for (const r of rows) {
    const j: Judged | null = judge(r, targetMinutes, now);
    if (j === null) continue;
    const s = out[hourOf(r.leadAt, r.zone)];
    s.leads += 1;
    if (j === "within") s.within += 1; else s.missed += 1;
  }
  for (const s of out) s.gap = s.leads >= MIN_FOR_MEDIAN && s.within / s.leads < GAP_SHARE;
  return out;
}
export const leadsInHour = (rows: LeadRow[], h: number, targetMinutes: number, now: number): LeadRow[] => rows.filter((r) => judge(r, targetMinutes, now) !== null && hourOf(r.leadAt, r.zone) === h);
export function hourTitle(stats: HourStat[], targetMinutes: number): string {
  const total = stats.reduce((s, x) => s + x.leads, 0);
  if (total < MIN_FOR_MEDIAN) return "Not enough leads in the last 14 days to see which hours are missed.";
  const gaps = stats.filter((s) => s.gap).sort((a, b) => b.missed - a.missed || a.hour - b.hour);
  if (gaps.length === 0) return `No hour of the day stands out: leads are answered inside ${targetMinutes} minutes about as often at every hour.`;
  const g = gaps[0];
  return `${hourWords(g.hour)} is the hour that misses most: ${g.missed} of ${g.leads} leads that arrived then were not answered inside ${targetMinutes} minutes.`;
}
export const hourSpec = (rows: LeadRow[], h: number, targetMinutes: number, now: number): RecordsSpec => {
  const mine = leadsInHour(rows, h, targetMinutes, now);
  return leadsSpec(mine.map(stripZone), now, { key: `hour:${h}`, title: `Leads that arrived at ${hourWords(h)}`, subtitle: `Last 14 days, in each client account's own time. Answered inside ${targetMinutes} minutes, answered later, or still waiting.`, noun: mine.length === 1 ? "lead" : "leads", count: mine.length });
};

// ---------- speed by source ----------

export type SourceStat = { name: string; leads: number; answered: number; medianSeconds: number | null; within: number; missed: number };
/** Per source (as typed in the CRM, grouped without regard to case): the judged leads, and the typical first reply once at least MIN_FOR_MEDIAN were answered. */
export function sourceStats(rows: LeadRow[], targetMinutes: number, now: number): SourceStat[] {
  const by = new Map<string, LeadRow[]>();
  for (const r of rows) {
    if (judge(r, targetMinutes, now) === null) continue;
    const k = sourceLabel(r.source).toLowerCase();
    by.set(k, [...(by.get(k) ?? []), r]);
  }
  return [...by.values()].map((g) => {
    const times = g.filter((r) => r.touchAt !== null).map((r) => replySeconds(r) as number);
    const within = g.filter((r) => judge(r, targetMinutes, now) === "within").length;
    return { name: sourceLabel(g[0].source), leads: g.length, answered: times.length, medianSeconds: times.length >= MIN_FOR_MEDIAN ? median(times) : null, within, missed: g.length - within };
  }).sort((a, b) => b.leads - a.leads || a.name.localeCompare(b.name));
}
export const leadsOfSource = (rows: LeadRow[], name: string, targetMinutes: number, now: number): LeadRow[] =>
  rows.filter((r) => judge(r, targetMinutes, now) !== null && sourceLabel(r.source).toLowerCase() === name.toLowerCase());
export function sourceTitle(stats: SourceStat[]): string {
  const timed = stats.filter((s) => s.medianSeconds !== null).sort((a, b) => (a.medianSeconds as number) - (b.medianSeconds as number));
  if (timed.length < 2) return stats.length === 0 ? "No leads in the last 14 days to compare by source." : "Not enough answered leads per source yet to compare how fast each is answered.";
  const slow = timed[timed.length - 1], fast = timed[0];
  return `${slow.name} leads wait longest for a first reply (${replyWords(slow.medianSeconds)}); ${fast.name} leads are answered fastest (${replyWords(fast.medianSeconds)}).`;
}
export const sourceSpec = (rows: LeadRow[], name: string, targetMinutes: number, now: number): RecordsSpec => {
  const mine = leadsOfSource(rows, name, targetMinutes, now);
  return leadsSpec(mine.map(stripZone), now, { key: `source:${name.toLowerCase()}`, title: `${name} leads`, subtitle: `Last 14 days. Answered inside ${targetMinutes} minutes, answered later, or still waiting.`, noun: mine.length === 1 ? "lead" : "leads", count: mine.length, preset: {} });
};

// ---------- workload by person ----------

export type PersonLoad = { name: string; waiting: number; oldestMinutes: number | null; replies: number; medianSeconds: number | null; flag: "overloaded" | "quiet" | null; unassigned: boolean };
export const NOBODY = "Nobody assigned";
export const OVERLOAD_MIN = 5;
export const QUIET_MIN_WAITING = 3;
/**
 * Leads waiting by the person who owns them in the CRM, with how many first replies that person sent in the last 14 days. Flags: overloaded when a person has at least
 * OVERLOAD_MIN leads waiting and at least twice the middle person's count (needs 3 people to compare); quiet when a person has QUIET_MIN_WAITING or more leads waiting and
 * sent no first reply in 14 days, but only when the ledger holds at least MIN_FOR_MEDIAN replies in all (otherwise silence means nothing). A median reply needs MIN_PER_PERSON.
 */
export function workload(waiting: TodayItem[], ledger: LeadRow[], now: number): PersonLoad[] {
  const lead = waiting.filter((i) => i.kind === "leads");
  const by = new Map<string, TodayItem[]>();
  for (const i of lead) by.set(i.owner ?? NOBODY, [...(by.get(i.owner ?? NOBODY) ?? []), i]);
  const replies = new Map<string, number[]>();
  for (const r of ledger) if (r.touchAt !== null && r.touchBy) replies.set(r.touchBy, [...(replies.get(r.touchBy) ?? []), replySeconds(r) as number]);
  const names = new Set([...by.keys(), ...replies.keys()]);
  const totalReplies = [...replies.values()].reduce((s, x) => s + x.length, 0);
  const rows: PersonLoad[] = [...names].map((name) => {
    const w = by.get(name) ?? [];
    const rep = replies.get(name) ?? [];
    const oldest = w.reduce<number | null>((m, i) => (i.at === null ? m : m === null ? i.at : Math.min(m, i.at)), null);
    return { name, waiting: w.length, oldestMinutes: oldest === null ? null : Math.max(0, Math.round((now - oldest) / 60_000)), replies: rep.length, medianSeconds: rep.length >= MIN_PER_PERSON ? median(rep) : null, flag: null, unassigned: name === NOBODY };
  });
  const people = rows.filter((r) => !r.unassigned && r.waiting > 0);
  const mid = people.length >= 3 ? median(people.map((p) => p.waiting)) : null;
  for (const r of rows) {
    if (r.unassigned) continue;
    if (mid !== null && r.waiting >= OVERLOAD_MIN && r.waiting >= 2 * mid) r.flag = "overloaded";
    else if (r.waiting >= QUIET_MIN_WAITING && r.replies === 0 && totalReplies >= MIN_FOR_MEDIAN) r.flag = "quiet";
  }
  return rows.filter((r) => r.waiting > 0 || r.replies > 0).sort((a, b) => b.waiting - a.waiting || b.replies - a.replies || a.name.localeCompare(b.name));
}
export const waitingOf = (waiting: TodayItem[], name: string): TodayItem[] => waiting.filter((i) => i.kind === "leads" && (i.owner ?? NOBODY) === name);

// ---------- accounts compared ----------

export type AccountSpeed = { locationId: string; name: string; answered: number; medianSeconds: number };
/** The typical first reply of each client account over the last 14 days; an account needs at least MIN_FOR_MEDIAN answered leads to be ranked. Fastest first. */
export function accountSpeeds(rows: LeadRow[]): { ranked: AccountSpeed[]; tooFew: number } {
  const by = new Map<string, LeadRow[]>();
  for (const r of rows) by.set(r.locationId, [...(by.get(r.locationId) ?? []), r]);
  const ranked: AccountSpeed[] = [];
  let tooFew = 0;
  for (const [locationId, g] of by) {
    const times = g.filter((r) => r.touchAt !== null).map((r) => replySeconds(r) as number);
    if (times.length >= MIN_FOR_MEDIAN) ranked.push({ locationId, name: g[0].accountName, answered: times.length, medianSeconds: median(times) });
    else tooFew += 1;
  }
  ranked.sort((a, b) => a.medianSeconds - b.medianSeconds || a.name.localeCompare(b.name));
  return { ranked, tooFew };
}
/** Top 3 fastest and bottom 3 slowest. With fewer than 6 ranked accounts the two lists would overlap, so the fastest half and the slowest half are shown. */
export function fastestSlowest(ranked: AccountSpeed[]): { fastest: AccountSpeed[]; slowest: AccountSpeed[] } {
  const k = Math.min(3, Math.floor(ranked.length / 2));
  return { fastest: ranked.slice(0, k), slowest: ranked.slice(ranked.length - k).reverse() };
}
export const answeredLeadsOf = (rows: LeadRow[], locationId: string): LeadRow[] => rows.filter((r) => r.locationId === locationId && r.touchAt !== null);

// ---------- the best next action ----------

export type NextAction = { locationId: string; kind: Kind; n: number; of: number; text: string; effect: string; itemIds: string[] };
const STEP: Record<Kind, { n: number; text: (n: number) => string; sort: (a: TodayItem, b: TodayItem) => number; left: (rest: number) => string }> = {
  leads: { n: 5, text: (n) => `Answer the ${n === 1 ? "longest-waiting lead" : `${n} longest-waiting leads`} first`, sort: (a, b) => (a.at ?? Infinity) - (b.at ?? Infinity), left: (r) => `${plural(r, "lead")} would still be waiting` },
  noshows: { n: 3, text: (n) => `Rebook ${plural(n, "no-show")}`, sort: (a, b) => (a.at ?? Infinity) - (b.at ?? Infinity), left: (r) => `${plural(r, "no-show")} would still need recovering` },
  appointments: { n: 5, text: (n) => `Mark the outcome of ${plural(n, "appointment")}`, sort: (a, b) => (a.at ?? Infinity) - (b.at ?? Infinity), left: (r) => `${plural(r, "appointment")} would still have no outcome` },
  stale: { n: 3, text: (n) => `Review the ${n === 1 ? "biggest stale deal" : `${n} biggest stale deals`}`, sort: (a, b) => (b.value ?? 0) - (a.value ?? 0), left: (r) => `${plural(r, "stale deal")} would still be open` },
  unanswered: { n: 5, text: (n) => `Reply to the ${n === 1 ? "oldest conversation" : `${n} oldest conversations`}`, sort: (a, b) => (a.at ?? Infinity) - (b.at ?? Infinity), left: (r) => `${plural(r, "conversation")} would still be waiting` },
};
/** One suggested step for a client account, from fixed rules: the account's top row in the queue decides the kind (leads: the 5 longest-waiting, no-shows: 3, appointments: 5, stale deals: the 3 biggest, conversations: the 5 oldest). The effect is arithmetic on the count, never a promise. */
export function nextAction(rows: QueueRow[], items: TodayItem[], locationId: string): NextAction | null {
  const top = rows.find((r) => r.locationId === locationId);
  if (!top) return null;
  const s = STEP[top.kind];
  const mine = items.filter((i) => i.locationId === locationId && i.kind === top.kind).sort(s.sort);
  if (mine.length === 0) return null;
  const n = Math.min(s.n, mine.length);
  const rest = Math.max(0, top.count - n);
  return { locationId, kind: top.kind, n, of: top.count, text: s.text(n), effect: rest === 0 ? "That would clear this kind of thing for the account." : `${s.left(rest)} after that.`, itemIds: mine.slice(0, n).map((i) => i.id) };
}

// ---------- the "why" behind a red row ----------

export type Why = { key: string; text: string; n: number; of: number; itemIds: string[] };
export const MIN_WHY = 2;
/**
 * Up to three measurable reasons behind a leads row, each a count of the same leads: how many have no owner, how many arrived outside 8 am to 6 pm in the account's time,
 * and how many share one source. A reason is listed only when it covers at least MIN_WHY leads and at least half of the row (a coincidence is not a reason). Nothing here says
 * what caused it; it says what the leads have in common. Other kinds of row have no "why" yet.
 */
export function whyOf(row: QueueRow, items: TodayItem[], zone: string): Why[] {
  if (row.kind !== "leads") return [];
  const mine = items.filter((i) => row.itemIds.includes(i.id));
  if (mine.length < MIN_WHY) return [];
  const out: Why[] = [];
  const add = (key: string, text: (n: number) => string, pick: (i: TodayItem) => boolean) => {
    const hit = mine.filter(pick);
    if (hit.length >= MIN_WHY && hit.length * 2 >= mine.length) out.push({ key, text: text(hit.length), n: hit.length, of: mine.length, itemIds: hit.map((i) => i.id) });
  };
  add("no_owner", (n) => `${n} of ${mine.length} have no owner in the CRM`, (i) => !i.owner);
  add("after_hours", (n) => `${n} of ${mine.length} arrived outside ${hourWords(DAY_FROM)} to ${hourWords(AFTER_HOURS_FROM)}`, (i) => i.at !== null && (hourOf(i.at, zone) >= AFTER_HOURS_FROM || hourOf(i.at, zone) < DAY_FROM));
  const sources = new Map<string, TodayItem[]>();
  for (const i of mine) { const k = sourceLabel(i.source ?? null); if (k !== NO_SOURCE) sources.set(k, [...(sources.get(k) ?? []), i]); }
  const top = [...sources.entries()].sort((a, b) => b[1].length - a[1].length)[0];
  if (top) add("source", (n) => `${n} of ${mine.length} came from ${top[0]}`, (i) => sourceLabel(i.source ?? null) === top[0]);
  return out.slice(0, 3);
}

// ---------- if nobody acts: the plain countdown ----------

export type Coming = { id: string; kind: Kind; locationId: string; accountName: string; name: string; /** When it goes wrong: a reply target passes, a deal turns stale, an appointment starts. */ at: number; value: number | null; contactId: string | null; url: string };
export type Forecast = {
  leads: Coming[]; deals: Coming[]; appointments: Coming[];
  dealDollars: number;
  /** The lead that passes its reply target first, for the countdown ring. */
  next: (Coming & { startedAt: number }) | null;
};
export const emptyForecast = (): Forecast => ({ leads: [], deals: [], appointments: [], dealDollars: 0, next: null });

/** Leads still inside their reply window (nobody has replied, the target has not passed): each passes the target at arrival + target. */
export function comingLeads(rows: LeadRow[], targetMinutes: number, now: number): Array<Coming & { startedAt: number }> {
  return rows.filter((r) => r.touchAt === null && judge(r, targetMinutes, now) === null && r.leadAt <= now)
    .map((r) => ({ id: `coming:lead:${r.id}`, kind: "leads" as const, locationId: r.locationId, accountName: r.accountName, name: r.name, at: r.leadAt + targetMinutes * 60_000, startedAt: r.leadAt, value: null, contactId: r.contactId, url: r.url }))
    .sort((a, b) => a.at - b.at || a.name.localeCompare(b.name));
}
export const forecastOf = (leads: Array<Coming & { startedAt: number }>, deals: Coming[], appointments: Coming[]): Forecast => ({
  leads, deals, appointments, dealDollars: deals.reduce((s, d) => s + (d.value ?? 0), 0), next: leads[0] ?? null,
});
export function forecastLine(f: Forecast, targetMinutes: number): string {
  const bits: string[] = [];
  if (f.leads.length > 0) bits.push(`${plural(f.leads.length, "lead")} will pass the ${targetMinutes}-minute reply target`);
  if (f.deals.length > 0) bits.push(`${plural(f.deals.length, "deal")}${f.dealDollars > 0 ? ` (${money(f.dealDollars)})` : ""} will turn stale`);
  if (f.appointments.length > 0) bits.push(`${plural(f.appointments.length, "appointment")} will need an outcome marked`);
  return bits.length === 0 ? "Nothing is about to go wrong today." : `If nobody acts today: ${bits.join(", ")}.`;
}

const COMING_COLS = [
  { key: "what", header: "What", type: "text", primary: true, w: 15 },
  { key: "account", header: "Client account", type: "text", facet: true, w: 13 },
  { key: "kind", header: "Kind", type: "kind", facet: true, w: 12 },
  { key: "at", header: "Goes wrong at", type: "date", w: 12 },
  { key: "value", header: "Deal value", type: "money", w: 9 },
  { key: "crm", header: "CRM", type: "link", w: 7 },
] as const;
export function comingSpec(list: Coming[], i: { key: string; title: string; subtitle: string; noun: string }): RecordsSpec {
  const rows: Rec[] = list.map((c) => ({
    id: c.id, url: c.url, lead: { contactId: c.contactId, locationId: c.locationId, name: c.name, account: c.accountName, note: "" },
    cells: { what: c.name, account: c.accountName, kind: KIND_LABEL[c.kind], at: c.at, value: c.value, crm: c.url },
  }));
  return { key: i.key, title: i.title, subtitle: i.subtitle, noun: i.noun, count: list.length, cols: trimColumns([...COMING_COLS], rows), rows, note: null, dateKey: "at", preset: {}, exportName: i.key };
}

export const NEVER_WORD = ageWords(NEVER_ANSWERED_MINUTES);
