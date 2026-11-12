// Cash features, pure rules (no database, unit tested): the morning "save this account" digest, the missed-lead recovery list and the stale / lost deal alerts.
// Definitions: docs/METRICS.md "Cash features". Every dollar figure here is an ESTIMATE and carries its formula; under the minimums there is no figure, only "not enough data".

// Time zones: "today" is the business's own day. Kept here (not imported) so this file has no imports and runs in the plain unit test runner.
export function validZone(tz: string | null | undefined): string {
  if (!tz) return "UTC";
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return tz; } catch { return "UTC"; }
}
const parts = (ms: number, tz: string) => {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: validZone(tz), year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23", weekday: "short" });
  const o: Record<string, string> = {};
  for (const x of f.formatToParts(new Date(ms))) o[x.type] = x.value;
  return o;
};
export const localDay = (ms: number, tz: string): string => { const x = parts(ms, tz); return `${x.year}-${x.month}-${x.day}`; };
export const localHour = (ms: number, tz: string): number => Number(parts(ms, tz).hour) % 24;
export const localWeekday = (ms: number, tz: string): number => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts(ms, tz).weekday);
export const DAY = 86_400_000;
export const HOUR = 3_600_000;

// ---- minimums (an estimate below these is "not enough data") ----
export const MIN_WON = 5; // wins in the last 180 days before an account's average value per lead is used
export const MIN_LEADS = 50; // new leads in the last 180 days before the same
export const MIN_SLA_ANSWERED = 20; // answered leads in each week before "reply speed slipped" is said
export const SLA_DROP_POINTS = 15; // a fall of this many points of leads answered in time counts as slipping
export const MIN_PRIOR_LEADS = 10; // "no activity" needs a normal week before it
export const MIN_DEALS_AT_RISK = 3; // deals with a value before a "deals at risk" dollar figure is given

// ---- windows ----
export const UNANSWERED_MIN_AGE_HOURS = 1; // a waiting message younger than this is not yet a missed lead
export const UNANSWERED_DAYS = 30;
export const MISSED_CALL_DAYS = 14;
export const NOSHOW_DAYS = 14;
export const SOON_DAYS = 7; // "going stale this week"
export const DEFAULT_LIMIT_DAYS = 30; // the stage limit when we have no history for the stage yet (marked "assumed")
export const LOST_DAYS = 14;

export const KIND_WORDS = {
  unanswered: { label: "Never answered", why: "A customer wrote and nobody has replied." },
  missed_call: { label: "Missed call not returned", why: "A call came in that nobody picked up, and nobody has called or written back." },
  no_show: { label: "No-show not booked again", why: "They booked, did not come, and have no later appointment." },
} as const;
export type RecoverKind = keyof typeof KIND_WORDS;
export const RECOVER_KINDS = Object.keys(KIND_WORDS) as RecoverKind[];

export const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

export const FORMULA =
  "Open deal value for the person when they have one. Otherwise this account's average value per lead: money won in the last 180 days divided by new leads in the last 180 days, used only after 5 wins and 50 leads. Deals past their usual time in a stage are counted at their value. These are estimates, not promises.";

/** Average value of one new lead for an account, from its own last 180 days. Null (not enough data) under the minimums. */
export function valuePerLead(a: { wonValue: number; won: number; newLeads: number }): number | null {
  if (a.won < MIN_WON || a.newLeads < MIN_LEADS || !(a.wonValue > 0)) return null;
  return a.wonValue / a.newLeads;
}

/** "About $4,200 (estimate)" or the reason there is no figure. */
export function dollarLine(value: number | null, rows: number): { text: string; enough: boolean } {
  if (value === null || !(value > 0)) return { text: rows > 0 ? "No dollar estimate yet: not enough deal history in this account." : "Nothing to estimate.", enough: false };
  return { text: `About ${money(value)} could be at stake (estimate)`, enough: true };
}

/** Leads answered in time, this week against the one before. Null shares until each week has enough answered leads. */
export function slaSlip(cur: { answered: number; within: number }, prev: { answered: number; within: number }): { enough: boolean; from: number | null; to: number | null; slipped: boolean } {
  if (cur.answered < MIN_SLA_ANSWERED || prev.answered < MIN_SLA_ANSWERED) return { enough: false, from: null, to: null, slipped: false };
  const to = Math.round((cur.within / cur.answered) * 100), from = Math.round((prev.within / prev.answered) * 100);
  return { enough: true, from, to, slipped: from - to >= SLA_DROP_POINTS };
}

// ---- save this account ----

export type SaveInput = {
  locationId: string; name: string;
  waiting: number; waitingOld: number; unmarked: number; noshows: number; staleDeals: number; openDeals: number;
  newLeads: { current: number; previous: number; enough: boolean };
  staffMessages: { current: number; previous: number; enough: boolean };
  needsPermission: boolean; syncOld: boolean;
  sla: { enough: boolean; from: number | null; to: number | null; slipped: boolean };
  /** Estimated dollars behind the open recovery list and the deals past their limit; null when there is no honest figure. */
  recoverValue: number | null; dealsValue: number | null; recoverCount: number; dealCount: number;
  muted?: boolean;
};
export type Evidence = { key: string; text: string; points: number };
export type SaveAccount = { locationId: string; name: string; points: number; evidence: Evidence[]; dollars: number | null; dollarText: string; recoverCount: number; dealCount: number; list: "recover" | "deals" | "speed" | "clients" };

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Why one account looks at risk, each reason with the number behind it. Empty when it looks fine. */
export function evidenceOf(a: SaveInput): Evidence[] {
  const e: Evidence[] = [];
  if (a.needsPermission) e.push({ key: "setup", text: "Setup is failing: needs permission, reconnect so we can read it", points: 5 });
  else if (a.syncOld) e.push({ key: "sync", text: "Its data has not refreshed in over a day", points: 3 });
  if (a.waitingOld > 0) e.push({ key: "waiting_old", text: `${plural(a.waitingOld, "person has", "people have")} waited over a day for a reply`, points: a.waitingOld >= 5 ? 5 : 3 });
  else if (a.waiting >= 5) e.push({ key: "waiting", text: `${a.waiting} people are waiting for a reply`, points: 2 });
  if (a.sla.slipped && a.sla.from !== null && a.sla.to !== null) e.push({ key: "sla", text: `Reply speed slipped: ${a.sla.from}% answered in time last week, ${a.sla.to}% this week`, points: 4 });
  if (a.noshows >= 3) e.push({ key: "noshows", text: `${a.noshows} no-shows in the last 7 days`, points: 3 });
  if (a.unmarked >= 3) e.push({ key: "unmarked", text: `${a.unmarked} appointments have no outcome, so show rates are wrong`, points: 1 });
  if (a.newLeads.enough && a.newLeads.previous > 0 && a.newLeads.current <= a.newLeads.previous * 0.6 && a.newLeads.current > 0) e.push({ key: "leads_down", text: `New leads fell from ${a.newLeads.previous} to ${a.newLeads.current}`, points: 3 });
  if (a.newLeads.previous >= MIN_PRIOR_LEADS && a.newLeads.current === 0 && a.staffMessages.previous > 0 && a.staffMessages.current === 0) e.push({ key: "no_activity", text: "No new leads and no team messages this week, after a normal week before", points: 4 });
  if (a.openDeals >= 5 && a.staleDeals / a.openDeals >= 0.5) e.push({ key: "stale", text: `${a.staleDeals} of ${a.openDeals} open deals have gone quiet`, points: 2 });
  return e;
}

export const AT_RISK_POINTS = 3;
export const SAVE_MAX = 5;

/** At most SAVE_MAX accounts most at risk today, with the evidence and the dollar line. Muted accounts are left out. Highest points first, then the most dollars, then name. Pure. */
export function rankSave(inputs: readonly SaveInput[]): { accounts: SaveAccount[]; more: number; checked: number } {
  const scored: SaveAccount[] = [];
  for (const a of inputs) {
    if (a.muted) continue;
    const evidence = evidenceOf(a);
    const points = evidence.reduce((t, x) => t + x.points, 0);
    if (points < AT_RISK_POINTS) continue;
    const parts = [a.recoverValue, a.dealsValue].filter((x): x is number => x !== null && x > 0);
    const dollars = parts.length ? parts.reduce((t, x) => t + x, 0) : null;
    const line = dollarLine(dollars, a.recoverCount + a.dealCount);
    const top = evidence.slice().sort((x, y) => y.points - x.points)[0]?.key;
    const list = top === "waiting_old" || top === "waiting" || top === "noshows" ? "recover" : top === "stale" ? "deals" : top === "sla" ? "speed" : "clients";
    scored.push({ locationId: a.locationId, name: a.name, points, evidence: evidence.sort((x, y) => y.points - x.points), dollars, dollarText: line.text, recoverCount: a.recoverCount, dealCount: a.dealCount, list });
  }
  scored.sort((x, y) => y.points - x.points || (y.dollars ?? 0) - (x.dollars ?? 0) || x.name.localeCompare(y.name));
  return { accounts: scored.slice(0, SAVE_MAX), more: Math.max(0, scored.length - SAVE_MAX), checked: inputs.filter((i) => !i.muted).length };
}

// ---- when the digest goes ----

const inWindow = (h: number, from: number | null, to: number | null) => {
  if (from === null || to === null || from === to) return false;
  return from < to ? h >= from && h < to : h >= from || h < to;
};

/** True at the chosen local hour (or up to 2 hours late), not on a quiet weekday, not inside quiet hours, and once per local day. Safe to call every hour. */
export function digestDue(nowMs: number, tzIn: string, hour: number, quietDays: readonly number[], quietFrom: number | null, quietTo: number | null, lastKey: string | null): { due: boolean; key: string } {
  const tz = validZone(tzIn);
  const key = localDay(nowMs, tz), h = localHour(nowMs, tz);
  const due = h >= hour && h < hour + 3 && !quietDays.includes(localWeekday(nowMs, tz)) && !inWindow(h, quietFrom, quietTo) && lastKey !== key;
  return { due, key };
}

const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export type DigestDeals = { staleCount: number; staleValue: number | null; soonCount: number; lostNoReason: number; lostCount: number } | null;

/** The one morning email: accounts most at risk (evidence, dollar line, one button each), the week's deals list on Mondays. No vendor words, nothing about leads' messages. */
export function digestEmail(i: { scope: string; accounts: SaveAccount[]; more: number; appUrl: string; stopUrl: string; deals: DigestDeals; monday: boolean }): { subject: string; text: string; html: string } {
  const link = (a: SaveAccount) => (a.list === "deals" ? `${i.appUrl}/app#pipeline` : a.list === "recover" ? `${i.appUrl}/app#today?tab=recover&account=${encodeURIComponent(a.locationId)}` : `${i.appUrl}/app#${a.list === "speed" ? "speed" : "clients"}`);
  const names = i.accounts.slice(0, 2).map((a) => a.name).join(", ");
  const subject = i.accounts.length ? `${i.accounts.length}${i.more ? "+" : ""} client account${i.accounts.length === 1 && !i.more ? "" : "s"} to save today: ${names}${i.accounts.length > 2 ? "..." : ""}` : "Save this account: nothing at risk today";
  const text: string[] = [i.scope, ""];
  const html: string[] = [`<p style="margin:0 0 12px;color:#555555">${esc(i.scope)}</p>`];
  if (!i.accounts.length) { text.push("No client account looks at risk this morning."); html.push("<p>No client account looks at risk this morning.</p>"); }
  i.accounts.forEach((a, n) => {
    text.push(`${n + 1}. ${a.name}`, ...a.evidence.slice(0, 3).map((e) => `   - ${e.text}`), `   ${a.dollarText}`, `   Open the list: ${link(a)}`, "");
    html.push(`<div style="margin:0 0 16px;padding:12px;border:1px solid #dddddd;border-radius:8px"><b>${n + 1}. ${esc(a.name)}</b><ul style="margin:6px 0;padding-left:18px">${a.evidence.slice(0, 3).map((e) => `<li>${esc(e.text)}</li>`).join("")}</ul><p style="margin:6px 0;color:#555555">${esc(a.dollarText)}</p><a href="${esc(link(a))}" style="display:inline-block;padding:8px 14px;background:#5b789a;color:#ffffff;border-radius:6px;text-decoration:none">Open the list</a></div>`);
  });
  if (i.more > 0) { text.push(`And ${i.more} more. Open your list: ${i.appUrl}/app#today`, ""); html.push(`<p>And ${i.more} more. <a href="${esc(i.appUrl)}/app#today">Open your list</a>.</p>`); }
  if (i.monday && i.deals) {
    const d = i.deals;
    const line = `Deals slipping this week: ${d.staleCount} past their usual time in a stage${d.staleValue !== null ? ` (about ${money(d.staleValue)}, estimate)` : ""}, ${d.soonCount} about to go quiet, ${d.lostCount} lost in the last 2 weeks${d.lostNoReason ? ` (${d.lostNoReason} with no reason recorded)` : ""}.`;
    text.push(line, `Open the deals: ${i.appUrl}/app#pipeline`, ""); html.push(`<p>${esc(line)} <a href="${esc(i.appUrl)}/app#pipeline">Open the deals</a>.</p>`);
  }
  text.push("You get one email a day. Dollar figures are estimates. Nothing here changes your CRM or messages your leads.", `Stop these emails: ${i.stopUrl}`);
  html.push(`<p style="color:#777777;font-size:12px">You get one email a day. Dollar figures are estimates. Nothing here changes your CRM or messages your leads. <a href="${esc(i.stopUrl)}">Stop these emails</a>.</p>`);
  return { subject, text: text.join("\n"), html: html.join("") };
}

// ---- deals ----

/** A deal's flag: stale when past its stage's usual time, soon when it will pass it within SOON_DAYS, else none. */
export function dealFlag(daysInStage: number | null, limitDays: number | null): "stale" | "soon" | null {
  if (daysInStage === null || !Number.isFinite(daysInStage)) return null;
  const limit = limitDays !== null && limitDays > 0 ? limitDays : DEFAULT_LIMIT_DAYS;
  if (daysInStage > limit) return "stale";
  return daysInStage + SOON_DAYS > limit ? "soon" : null;
}

/** Dollars at risk of the deals behind a count: null under MIN_DEALS_AT_RISK valued deals. */
export const dealsAtRisk = (values: readonly number[]): number | null => {
  const v = values.filter((x) => x > 0);
  return v.length >= MIN_DEALS_AT_RISK ? v.reduce((t, x) => t + x, 0) : null;
};

/** Plain lines for the weekly receipt an agency shows a client. Estimates are labelled; a line with nothing behind it is left out. */
export function cashReceiptLines(r: { recovered: number; recoveredValue: number | null; moved: number; movedValue: number | null; lostNoReason: number }): string[] {
  const out: string[] = [];
  if (r.recovered > 0) out.push(`${r.recovered} missed ${r.recovered === 1 ? "lead was" : "leads were"} followed up after we flagged ${r.recovered === 1 ? "it" : "them"}${r.recoveredValue ? `, worth about ${money(r.recoveredValue)} (estimate)` : ""}.`);
  if (r.moved > 0) out.push(`${r.moved} flagged ${r.moved === 1 ? "deal moved" : "deals moved"} forward or closed${r.movedValue ? `, about ${money(r.movedValue)} (estimate)` : ""}.`);
  if (r.lostNoReason > 0) out.push(`${r.lostNoReason} lost ${r.lostNoReason === 1 ? "deal has" : "deals have"} no reason recorded in the CRM.`);
  return out;
}

/** Keyset cursor for lists ordered by value then a stable id: "value|id". Anything malformed is no cursor. */
export function parseCursor(c: string | null | undefined): { v: number; id: string } | null {
  if (!c || c.length > 200) return null;
  const i = c.indexOf("|");
  if (i < 1) return null;
  const v = Number(c.slice(0, i)), id = c.slice(i + 1);
  return Number.isFinite(v) && id.length > 0 && id.length <= 160 ? { v, id } : null;
}
export const makeCursor = (v: number, id: string) => `${v}|${id}`;
