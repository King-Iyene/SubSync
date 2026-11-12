import { durationText, proofTextProblems } from "./moat-core.ts";
import { validLogoUrl } from "../brand-logo.ts";

// Branded client Proof page and monthly report (stage PR). Pure code, no database: month windows, the shape of one prepared report, the plain words for every number (what it means and how it
// is counted), the change wording, the headline sentence, the copy-as-text version, and the status of a report. Nothing here is a benchmark: every comparison is the account's own earlier month.
// A figure that cannot be measured is null and is shown as "not enough data" or "not recorded yet", never as a zero or a flat line.

export const PR_FLAGS = ["pr_report", "pr_page", "pr_auto"] as const;
export const SECTION_KEYS = ["reply", "appointments", "pipeline", "caught", "timeline", "trends"] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];
export type Sections = Record<SectionKey, boolean>;
export const SECTION_LABEL: Record<SectionKey, string> = {
  reply: "Reply speed and leads won back", appointments: "Appointments", pipeline: "Deals", caught: "What was caught and fixed", timeline: "What we did for you", trends: "Trend lines",
};

export const MIN_LEADS = 5; // fewer new leads than this and a reply time is not measured
export const MIN_SHOWS = 3; // fewer appointments with an outcome than this and a no-show rate is not measured
export const MIN_PREV = 3; // an earlier month with fewer than this is quoted, not turned into a percentage
export const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;
export const MONTH_SHAPE = /^\d{4}-(0[1-9]|1[0-2])$/;
export const SAMPLE_TOKEN = "sample";

export const defaultSections = (): Sections => ({ reply: true, appointments: true, pipeline: true, caught: true, timeline: true, trends: true });
export function normalizeSections(v: unknown): Sections {
  const out = defaultSections();
  if (v && typeof v === "object") for (const k of SECTION_KEYS) { const x = (v as Record<string, unknown>)[k]; if (typeof x === "boolean") out[k] = x; }
  return out;
}

export type PrSettings = { displayName: string | null; logoUrl: string | null; brandColor: string | null; intro: string | null; sections: Sections; nameStaff: boolean; autoDraft: boolean };
export const DEFAULT_SETTINGS: PrSettings = { displayName: null, logoUrl: null, brandColor: null, intro: null, sections: defaultSections(), nameStaff: false, autoDraft: true };

/** Plain text from a person: trimmed, one blank line at most, cut to length. Empty becomes null. */
export function cleanText(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.replace(/\r/g, "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").replace(/\n{3,}/g, "\n\n").trim().slice(0, max);
  return t || null;
}
export const cleanColor = (v: unknown): string | null => (typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v.trim()) ? v.trim().toLowerCase() : null);
export const cleanLogo = (v: unknown): string | null => validLogoUrl(typeof v === "string" ? v : null);

/** Words that must never reach the client's page: the platform's names and promises. Returns a plain reason or null. */
export function textProblem(...parts: Array<string | null | undefined>): string | null {
  const bad = proofTextProblems(parts.filter(Boolean).join(" "));
  if (bad.includes("vendor word")) return "That text contains a word that cannot be shown to your client";
  if (bad.includes("promise wording")) return "Please avoid promises (for example guarantee or warrant) in a report";
  return null;
}

// ---------------------------------------------------------------- months

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const pad = (n: number) => String(n).padStart(2, "0");
export const monthLabel = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
export const monthOf = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
const addMonths = (m: string, n: number) => { const t = Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7)) - 1 + n; return `${Math.floor(t / 12)}-${pad((t % 12) + 1)}`; };
const dayStr = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const monthStartMs = (m: string) => Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1, 1);

export type MonthWindow = { month: string; label: string; prevLabel: string; partial: boolean; from: string; to: string; prevMonth: string; prevFrom: string; prevTo: string; lastDay: string };
/** `from` and `to` are dates (to is exclusive). The month in progress is compared with the same number of days of the month before, so a half month is never set against a whole one. */
export function monthWindow(month: string, now: Date): MonthWindow {
  const cur = monthOf(now), prev = addMonths(month, -1), start = monthStartMs(month), next = monthStartMs(addMonths(month, 1));
  const partial = month === cur;
  const toMs = partial ? Math.min(next, Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) + 86_400_000) : next;
  const days = Math.round((toMs - start) / 86_400_000);
  const prevStart = monthStartMs(prev);
  const prevToMs = partial ? Math.min(monthStartMs(month), prevStart + days * 86_400_000) : start;
  return { month, label: monthLabel(month), prevLabel: monthLabel(prev), partial, from: dayStr(start), to: dayStr(toMs), prevMonth: prev, prevFrom: dayStr(prevStart), prevTo: dayStr(prevToMs), lastDay: dayStr(toMs - 86_400_000) };
}
/** The months a report can be made for: the month before this one first, then this month so far, then older ones. */
export function periodChoices(now: Date, n = 7): string[] {
  const cur = monthOf(now), out = [addMonths(cur, -1), cur];
  for (let i = 2; i < n; i++) out.push(addMonths(cur, -i));
  return out;
}
export const validPeriod = (v: unknown, now: Date): v is string => typeof v === "string" && MONTH_SHAPE.test(v) && v <= monthOf(now) && v >= addMonths(monthOf(now), -24);
/** The six months that end with this one, oldest first, for the trend lines. */
export const trendMonths = (month: string): string[] => [5, 4, 3, 2, 1, 0].map((i) => addMonths(month, -i));
export { addMonths };

// ---------------------------------------------------------------- the report

export type Metric = { current: number | null; previous: number | null };
export type TrendPoint = { month: string; leads: number | null; withinPct: number | null; showRate: number | null; won: number | null };
export type TimelineItem = { on: string; text: string };
export type PrPayload = {
  v: 1;
  account: string;
  month: string; label: string; prevLabel: string; partial: boolean; from: string; to: string;
  builtAt: string;
  historyStarts: string | null;
  targetMinutes: number;
  clock: "working hours" | "every hour";
  leads: Metric; replyMedian: Metric; withinTarget: Metric; neverAnswered: number | null;
  recovered: Metric;
  booked: Metric; showed: Metric; noShowRate: Metric;
  moved: { deals: Metric; value: Metric };
  won: { deals: Metric; value: Metric };
  caught: { found: number | null; fixed: number | null; stillOpen: number | null; typicalFixMinutes: number | null };
  timeline: TimelineItem[];
  trend: TrendPoint[];
  team: Array<{ name: string; firstReplies: number; medianMinutes: number | null }> | null;
};

export type InfoKey = "leads" | "reply" | "within" | "recovered" | "booked" | "noshow" | "moved" | "won" | "caught" | "fixed";
export const METRIC_INFO: Record<InfoKey, { label: string; meaning: string; formula: string }> = {
  leads: { label: "New leads", meaning: "People who got in touch or were added as a new lead this month.", formula: "Each new lead is counted once, on the day they first arrived. Leads from the last hour are left out because nobody has had time to answer them." },
  reply: { label: "Typical first reply", meaning: "Half of new leads got a reply at least this fast.", formula: "For every new lead: the time from arriving to the first reply from a person on the team. Automatic messages do not count unless your company has chosen to count them. The middle value of all of them is shown." },
  within: { label: "Answered in time", meaning: "The share of new leads that got a first reply inside the agreed reply time.", formula: "Leads with a first reply inside the target time, divided by all new leads in the month. A lead nobody answered counts against the share." },
  recovered: { label: "Leads won back", meaning: "Leads that had gone quiet and were then answered, called back or booked after we flagged them.", formula: "Each item we flagged (a lead waiting for a reply, a missed call, a no-show) that our later records show a person resolved by replying, calling back or rebooking." },
  booked: { label: "Appointments booked", meaning: "Appointments that were made this month.", formula: "Appointments created in the month, whatever day they are for." },
  noshow: { label: "No-show rate", meaning: "Of the appointments with a recorded outcome, the share where the person did not come.", formula: "No-shows divided by appointments marked as showed or no-show. Appointments with no outcome recorded are left out, so this is never flattered." },
  moved: { label: "Deals that moved forward", meaning: "Deals that advanced to a new stage this month, and what they are worth.", formula: "Each deal that changed stage at least once in the month is counted once, with its value as recorded in the pipeline. This is the recorded value, not a forecast." },
  won: { label: "Deals won", meaning: "Deals marked as won this month, and what they are worth.", formula: "Deals whose status changed to won during the month, and their recorded value." },
  caught: { label: "Problems caught", meaning: "Things that needed attention, found by our daily checks, such as a lead waiting for a reply.", formula: "Problems found in the weeks that started this month, from the daily record we keep for this account." },
  fixed: { label: "Fixed", meaning: "The caught problems that our later records show were cleared.", formula: "A problem counts as fixed when a later check no longer finds it. Still-open problems are shown too." },
};

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-10-31" as "31 Oct 2026". */
export const longDay = (d: string) => { const [y, m, day] = d.split("-"); return `${Number(day)} ${SHORT_MONTHS[Number(m) - 1]} ${y}`; };
/** "September 2026" as "September", for the words next to a change. */
export const monthName = (label: string) => label.split(" ")[0];
const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const int = (n: number) => Math.round(n).toLocaleString("en-US");
export const fmtMoney = money;
export const fmtInt = int;
export const fmtPct = (n: number) => `${Math.round(n)}%`;
export const fmtMinutes = (n: number) => durationText(n);

export type Change = { text: string; tone: "good" | "bad" | "flat" } | null;
/** The wording of a change from the earlier period, with a direction word so it never relies on colour. `better` says whether higher or lower is good. */
export function changeOf(kind: "count" | "money" | "pct" | "minutes", cur: number | null, prev: number | null, prevLabel: string, better: "up" | "down" = "up"): Change {
  if (cur === null || prev === null) return null;
  const tone = (d: number): "good" | "bad" | "flat" => (d === 0 ? "flat" : (d > 0) === (better === "up") ? "good" : "bad");
  if (kind === "pct") {
    const d = Math.round(cur - prev);
    return d === 0 ? { text: `same as ${prevLabel}`, tone: "flat" } : { text: `${d > 0 ? "up" : "down"} ${Math.abs(d)} point${Math.abs(d) === 1 ? "" : "s"} on ${prevLabel}`, tone: tone(d) };
  }
  if (kind === "minutes") {
    const diff = cur - prev;
    if (Math.abs(diff) < 1 || Math.abs(diff) / Math.max(prev, 1) < 0.1) return { text: `about the same as ${prevLabel} (${durationText(prev)})`, tone: "flat" };
    return { text: `${diff < 0 ? "faster" : "slower"} than ${prevLabel} (${durationText(prev)})`, tone: diff < 0 ? "good" : "bad" };
  }
  if (prev < MIN_PREV || (kind === "money" && prev <= 0)) return { text: `${prevLabel}: ${kind === "money" ? money(prev) : int(prev)}`, tone: "flat" };
  const pct = Math.round(((cur - prev) / prev) * 100);
  return pct === 0 ? { text: `same as ${prevLabel}`, tone: "flat" } : { text: `${pct > 0 ? "up" : "down"} ${Math.abs(pct)}% on ${prevLabel}`, tone: tone(pct) };
}

// ---------------------------------------------------------------- a figure that cannot be measured

export const NOT_ENOUGH_LEADS = "Not enough new leads this month to measure reply times fairly.";
export const NOT_RECORDED = "Not recorded yet";
export const NOT_ENOUGH_DATA = "Not enough data";

/** The headline: two plain sentences from the measured figures only. A sentence is left out when its figure is missing. */
export function headline(p: PrPayload): string {
  const when = p.partial ? `So far in ${p.label.split(" ")[0]}` : `In ${p.label.split(" ")[0]}`;
  const out: string[] = [];
  const first: string[] = [];
  if (p.leads.current !== null && p.leads.current > 0) first.push(`${int(p.leads.current)} new lead${p.leads.current === 1 ? "" : "s"} came in`);
  if (p.withinTarget.current !== null) first.push(`${fmtPct(p.withinTarget.current)} got a first reply within ${durationText(p.targetMinutes)}`);
  if (first.length) out.push(`${when}, ${first.join(" and ")}.`);
  const second: string[] = [];
  if (p.recovered.current !== null && p.recovered.current > 0) second.push(`${int(p.recovered.current)} lead${p.recovered.current === 1 ? "" : "s"} that had gone quiet ${p.recovered.current === 1 ? "was" : "were"} won back`);
  if (p.booked.current !== null && p.booked.current > 0) second.push(`${int(p.booked.current)} appointment${p.booked.current === 1 ? "" : "s"} ${p.booked.current === 1 ? "was" : "were"} booked`);
  if (p.won.deals.current !== null && p.won.deals.current > 0) second.push(`${int(p.won.deals.current)} deal${p.won.deals.current === 1 ? "" : "s"} won${p.won.value.current ? ` (${money(p.won.value.current)})` : ""}`);
  if (second.length) out.push(`${second.length > 1 ? second.slice(0, -1).join(", ") + " and " + second[second.length - 1] : second[0]}.`);
  return out.length ? out.join(" ") : `Not enough has been recorded for ${p.label} yet to summarise it. This page fills in as records build up.`;
}

/** Charts need at least two real months. Below that the page says when the record starts instead of drawing a line. */
export function trendReady(points: Array<number | null>): boolean { return points.filter((v) => v !== null).length >= 2; }

export type Brand = { name: string; logoUrl: string | null; color: string | null };

const lines = (rows: Array<string | null>) => rows.filter((r): r is string => r !== null);
/** The whole report as plain text, for pasting into an email. Only sections that are switched on, only figures that were measured. */
export function reportText(p: PrPayload, brand: Brand, intro: string | null, sections: Sections): string {
  const pl = monthName(p.prevLabel);
  const m = (k: string, v: number | null, fmt: (n: number) => string, c: Change) => (v === null ? null : `- ${k}: ${fmt(v)}${c ? ` (${c.text})` : ""}`);
  const out: Array<string | null> = [`${brand.name}: ${p.account}`, `${p.label}${p.partial ? ` (to ${p.to === p.from ? p.from : p.to})` : ""}`, "", intro, intro ? "" : null, headline(p), ""];
  out.push(...lines([m("New leads", p.leads.current, int, changeOf("count", p.leads.current, p.leads.previous, pl))]));
  if (sections.reply) {
    out.push(...lines([
      m("Typical first reply", p.replyMedian.current, fmtMinutes, changeOf("minutes", p.replyMedian.current, p.replyMedian.previous, pl, "down")),
      m(`Answered within ${durationText(p.targetMinutes)}`, p.withinTarget.current, fmtPct, changeOf("pct", p.withinTarget.current, p.withinTarget.previous, pl)),
      m("Leads won back", p.recovered.current, int, changeOf("count", p.recovered.current, p.recovered.previous, pl)),
    ]));
  }
  if (sections.appointments) {
    out.push(...lines([
      m("Appointments booked", p.booked.current, int, changeOf("count", p.booked.current, p.booked.previous, pl)),
      m("Showed up", p.showed.current, int, changeOf("count", p.showed.current, p.showed.previous, pl)),
      m("No-show rate", p.noShowRate.current, fmtPct, changeOf("pct", p.noShowRate.current, p.noShowRate.previous, pl, "down")),
    ]));
  }
  if (sections.pipeline) {
    out.push(...lines([
      m("Deals that moved forward", p.moved.deals.current, int, changeOf("count", p.moved.deals.current, p.moved.deals.previous, pl)),
      m("Value of deals that moved forward", p.moved.value.current, money, null),
      m("Deals won", p.won.deals.current, int, changeOf("count", p.won.deals.current, p.won.deals.previous, pl)),
      m("Value of deals won", p.won.value.current, money, changeOf("money", p.won.value.current, p.won.value.previous, pl)),
    ]));
  }
  if (sections.caught && p.caught.found !== null) out.push("", `Caught and fixed: ${int(p.caught.found)} problem${p.caught.found === 1 ? "" : "s"} caught, ${int(p.caught.fixed ?? 0)} fixed${p.caught.stillOpen ? `, ${int(p.caught.stillOpen)} still open` : ""}.`);
  if (sections.timeline && p.timeline.length) out.push("", "What we did for you:", ...p.timeline.map((t) => `- ${longDay(t.on)}: ${t.text}`));
  out.push("", "These figures are counted from the account's own records for the period shown. They describe the past and are not a promise about the future.");
  return out.filter((l): l is string => l !== null).join("\n").replace(/\n{3,}/g, "\n\n");
}

// ---------------------------------------------------------------- the agency's list

export type PrStatus = "none" | "draft" | "shared" | "viewed";
export const STATUS_LABEL: Record<PrStatus, string> = { none: "Not prepared", draft: "Draft", shared: "Shared", viewed: "Viewed" };
export function statusOf(r: { exists: boolean; shared: boolean; sharedAt: string | null; lastViewedAt: string | null }): PrStatus {
  if (!r.exists) return "none";
  if (!r.shared) return "draft";
  return r.lastViewedAt && r.sharedAt && Date.parse(r.lastViewedAt) >= Date.parse(r.sharedAt) ? "viewed" : "shared";
}

export type PrRow = {
  locationId: string; name: string; status: PrStatus; linkOff: boolean; builtAt: string | null; sharedAt: string | null; auto: boolean;
  views: number; lastViewedAt: string | null; hasLink: boolean; leads: number | null;
};

// ---------------------------------------------------------------- sample (only behind ?prfx, always labelled)

export function samplePayload(now = new Date()): PrPayload {
  const w = monthWindow(addMonths(monthOf(now), -1), now);
  const months = trendMonths(w.month);
  const lead = [96, 104, 88, 121, 133, 142], within = [62, 66, 71, 80, 84, 91], show = [68, 70, 66, 74, 78, 83], won = [9800, 14200, 8800, 17600, 19900, 23400];
  return {
    v: 1, account: "Sample Roofing Co", month: w.month, label: w.label, prevLabel: w.prevLabel, partial: false, from: w.from, to: w.lastDay, builtAt: now.toISOString(), historyStarts: months[0] + "-01",
    targetMinutes: 5, clock: "working hours",
    leads: { current: 142, previous: 133 }, replyMedian: { current: 3, previous: 5 }, withinTarget: { current: 91, previous: 84 }, neverAnswered: 4,
    recovered: { current: 11, previous: 7 }, booked: { current: 38, previous: 35 }, showed: { current: 25, previous: 21 }, noShowRate: { current: 17, previous: 22 },
    moved: { deals: { current: 31, previous: 27 }, value: { current: 186400, previous: 152000 } }, won: { deals: { current: 9, previous: 8 }, value: { current: 23400, previous: 19900 } },
    caught: { found: 23, fixed: 20, stillOpen: 3, typicalFixMinutes: 42 },
    timeline: [
      { on: w.lastDay, text: "Month closed: figures counted from this account's own records." },
      { on: addDays(w.lastDay, -6), text: "Week of the 20th: caught 6 problems, 6 fixed (typically within 38 min)." },
      { on: addDays(w.lastDay, -11), text: "4 leads that had gone quiet were answered after we flagged them." },
      { on: addDays(w.lastDay, -13), text: "Week of the 13th: caught 5 problems, 4 fixed (typically within 51 min)." },
      { on: addDays(w.lastDay, -20), text: "2 no-shows were rebooked after we flagged them." },
    ],
    trend: months.map((m, i) => ({ month: m, leads: lead[i], withinPct: within[i], showRate: show[i], won: won[i] })),
    team: null,
  };
}
function addDays(day: string, n: number) { return dayStr(Date.parse(day + "T00:00:00Z") + n * 86_400_000); }
export { addDays };
