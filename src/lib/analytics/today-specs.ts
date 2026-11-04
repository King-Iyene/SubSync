// The records behind each mark on Today, one function per kind of mark. Pure. Each takes the data the page already holds and returns a RecordsSpec whose `count` is
// the number that was on the mark. The unit test (src/lib/__tests__/today-specs.test.ts) opens every mark of a fixture and checks that the count equals the rows.

import type { AlertRow, RecordsSpec } from "./today-records.ts";
import { accountsSpec, alertsSpec, itemsSpec, leadsSpec } from "./today-records.ts";
import { accountsNeedingYou, ageWords, KIND_LABEL, money, type AccountFacts, type Kind, type Proof, type TodayItem } from "./today-queue.ts";
import { comingSpec, hourSpec, leadsInHour, sourceSpec, waitingOf, answeredLeadsOf, type Coming, type Insight, type LeadRow, type SinceVisit } from "./today-smart.ts";
import { junkDaysOf, type View } from "./today-state.ts";
import type { QueueRow } from "./today-queue.ts";

const DAY = 86_400_000;
const plural = (n: number, one: string, many = one + "s") => (n === 1 ? one : many);
const strip = (l: LeadRow) => { const { zone: _z, ...rest } = l; void _z; return rest; };

export type SpecEnv = { now: number; view: View; accounts: AccountFacts[]; staleDays: number; targetMinutes: number; ledger: LeadRow[]; scope: "all" | "account"; excluded: boolean };

const SUBTITLE: Record<Kind, (e: SpecEnv) => string> = {
  replies: (e) => `People whose message nobody has answered: new leads past the ${e.targetMinutes}-minute reply target, and customers who wrote last. Each person once, longest wait first.`,
  appointments: () => "Past appointments with no outcome marked, so they count as neither a show nor a no-show.",
  noshows: () => "People who missed an appointment in the last 14 days and have not booked another.",
  stale: (e) => `Open deals with a value and an owner that have not moved in ${e.staleDays} days or more. Biggest first.`,
};
/** Where a list comes from, in words: the account that was clicked, the one account the page is showing, or every client account. A list never says "all client accounts" when the page shows one. */
const only = (e: SpecEnv) => (e.accounts.length === 1 ? e.accounts[0].name : null);
const where = (e: SpecEnv, accountName?: string) => { const n = accountName ?? only(e); return n ? `${n}` : e.scope === "account" ? "" : "All client accounts"; };
/** "KD Squares LTD, waiting for a reply": the account first, then exactly what was clicked. */
const titled = (e: SpecEnv, what: string, accountName?: string) => { const w = where(e, accountName); return w ? `${w}, ${what}` : what[0].toUpperCase() + what.slice(1); };
const NOUN: Record<Kind, [string, string]> = { replies: ["person waiting", "people waiting"], appointments: ["appointment", "appointments"], noshows: ["no-show", "no-shows"], stale: ["deal", "deals"] };
const nounOf = (k: Kind, n: number) => NOUN[k][n === 1 ? 0 : 1];

/** A slice of the donut, a legend row, or a figure tile of that kind. Count: the total for the kind. */
export function specKind(kind: Kind, e: SpecEnv, accountId?: string): RecordsSpec {
  const items = e.view.items.filter((i) => i.kind === kind && (!accountId || i.locationId === accountId));
  const name = accountId ? e.accounts.find((a) => a.id === accountId)?.name : undefined;
  const count = accountId ? items.length : e.view.totals[kind].count;
  const note = kind === "stale" && e.excluded && e.view.junk.items.length > 0 ? `Left out: ${e.view.junk.items.length} test or very old ${plural(e.view.junk.items.length, "deal")} worth ${money(e.view.junk.dollars)}. Switch off "Exclude test and very old deals" to include them.` : undefined;
  return itemsSpec(items, e.now, { key: `kind:${kind}${accountId ? `:${accountId}` : ""}`, title: titled(e, KIND_LABEL[kind].toLowerCase(), name), subtitle: SUBTITLE[kind](e), noun: nounOf(kind, count), count, note, exportName: `${kind}${name ? `-${name}` : ""}` });
}

/** A Fix first row (its amount or its Show button). Count: the row's count. */
export function specRow(row: QueueRow, e: SpecEnv): RecordsSpec {
  const items = e.view.items.filter((i) => row.itemIds.includes(i.id));
  return itemsSpec(items, e.now, { key: `row:${row.key}`, title: `${row.accountName}, ${KIND_LABEL[row.kind].toLowerCase()}`, subtitle: row.text, noun: nounOf(row.kind, row.count), count: row.count, exportName: `${row.kind}-${row.accountName}` });
}

/** An account bar. Count: the things to fix in that account. */
export function specAccount(locationId: string, e: SpecEnv): RecordsSpec {
  const items = e.view.items.filter((i) => i.locationId === locationId);
  const name = e.accounts.find((a) => a.id === locationId)?.name ?? "Client account";
  return itemsSpec(items, e.now, { key: `account:${locationId}`, title: name, subtitle: "Everything in this client account that needs a person, most urgent kind first.", noun: items.length === 1 ? "thing to fix" : "things to fix", count: items.length, exportName: `fix-${name}` });
}

/** "13 clients": one row per client account with something to fix. Count: the number of accounts. */
export function specClients(e: SpecEnv): RecordsSpec {
  const need = accountsNeedingYou(e.view.queue, new Map(e.accounts.map((a) => [a.id, a])), 10_000);
  const oldest = new Map<string, number>();
  for (const r of e.view.queue) oldest.set(r.locationId, Math.max(oldest.get(r.locationId) ?? 0, r.ageMinutes));
  return accountsSpec(need.rows.map((a) => ({ locationId: a.locationId, name: a.name, state: a.state, things: a.count, dollars: a.dollars, oldestMinutes: oldest.get(a.locationId) ?? null, reason: a.reason, url: a.url })),
    { key: "clients", title: `${need.total} ${plural(need.total, "client")} need you today`, subtitle: "Every client account with at least one thing to fix, the most urgent first.", noun: plural(need.total, "client account"), count: need.total, exportName: "clients-needing-you" });
}

/** "$1,397,934 is at risk": the counted stale deals the figure adds up. Count: the number of those deals. */
export function specDollars(e: SpecEnv): RecordsSpec {
  const s = specKind("stale", e);
  return { ...s, key: "dollars", title: `${money(e.view.totals.stale.dollars ?? 0)} at risk, deals gone quiet`, subtitle: `The open deals behind the dollar figure: each has a value and an owner and has not moved in ${e.staleDays} days or more. The figure is their values added up.` };
}

/** On one account the headline says "N things need you". Count: all of them. */
export function specThings(e: SpecEnv): RecordsSpec {
  const items = e.view.items;
  const count = Object.values(e.view.totals).reduce((s, t) => s + t.count, 0);
  return itemsSpec(items, e.now, { key: "things", title: "Everything that needs you today", subtitle: "People waiting for a reply, appointments to mark, no-shows to win back and deals gone quiet.", noun: count === 1 ? "thing" : "things", count, exportName: "needs-you-today" });
}

/** Alerts: raised, cleared or still open in the last 7 days, or one day of them. */
export function specAlerts(proof: Proof, which: "raised" | "cleared" | "open" | { day: number }): RecordsSpec {
  const sev = (s: string) => (s === "critical" ? "Urgent" : s === "warning" ? "Soon" : "When you can");
  const row = (a: { id: string; accountName: string; title: string; severity: string }, what: "Raised" | "Cleared", at: number): AlertRow => ({ id: a.id, accountName: a.accountName, title: a.title, what, at, severity: sev(a.severity) });
  let rows: AlertRow[] = [];
  let title = "", subtitle = "";
  if (which === "raised") { rows = proof.days.flatMap((d) => d.raised.map((a) => row(a, "Raised", a.createdAt))); title = "Alerts raised in the last 7 days"; subtitle = "Every alert SubSync raised in the last 7 days."; }
  else if (which === "cleared") { rows = proof.days.flatMap((d) => d.cleared.map((a) => row(a, "Cleared", a.resolvedAt as number))); title = "Alerts cleared in the last 7 days"; subtitle = "The problem is gone from your CRM data. SubSync cannot tell whether a person fixed it or it went away on its own."; }
  else if (which === "open") { rows = proof.openAlerts.map((a) => row(a, "Raised", a.createdAt)); title = "Alerts still open"; subtitle = "Raised by SubSync and not gone yet."; }
  else {
    const d = proof.days[which.day];
    rows = [...d.raised.map((a) => row(a, "Raised", a.createdAt)), ...d.cleared.map((a) => row(a, "Cleared", a.resolvedAt as number))];
    title = `Alerts on ${d.label}, ${d.day}`; subtitle = "Alerts SubSync raised that day and alerts that cleared that day.";
  }
  return alertsSpec(rows, { key: `alerts:${typeof which === "string" ? which : which.day}`, title, subtitle, noun: plural(rows.length, "alert"), count: rows.length, exportName: "alerts" });
}

/** The typical first reply: leads that arrived in (to - days, to] and have a first reply. Count: how many replies (the figure's sample). */
export function specReplies(e: SpecEnv, to: number, days: number, title: string): RecordsSpec {
  const rows = e.ledger.filter((l) => l.touchAt !== null && l.leadAt > to - days * DAY && l.leadAt <= to);
  const fromTotal = rows.length;
  return leadsSpec(rows.map(strip), e.now, { key: `replies:${to}`, title, subtitle: `Leads that arrived in the ${days} days up to ${new Date(to).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })} and got a first reply. The typical time is the middle one.`, noun: plural(fromTotal, "reply", "replies"), count: fromTotal, exportName: "first-replies" });
}
/** The day a sparkline point stands for: `back` days before now, found from its date. */
export function pointEnd(dayKey: string, now: number): number {
  const today = new Date(now).toISOString().slice(0, 10);
  const back = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${dayKey}T00:00:00Z`)) / DAY);
  return now - back * DAY;
}

export function specInsight(i: Insight, e: SpecEnv): RecordsSpec {
  if (i.leads) {
    const cut = i.sample > i.leads.length;
    return leadsSpec(i.leads, e.now, { key: `insight:${i.key}`, title: i.title, subtitle: i.subtitle, noun: plural(i.sample, "lead"), count: i.sample, note: cut ? `SubSync loaded the first ${i.leads.length} of ${i.sample}.` : null, exportName: i.key });
  }
  const items = e.view.items.filter((x) => i.itemIds?.includes(x.id));
  return itemsSpec(items, e.now, { key: `insight:${i.key}`, title: i.title, subtitle: i.subtitle, noun: plural(i.sample, "no-show"), count: i.sample, exportName: i.key });
}

export function specSince(k: "new" | "breached" | "answered" | "alerts", s: SinceVisit, e: SpecEnv): RecordsSpec {
  const when = new Date(s.since).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" });
  if (k === "alerts") {
    const rows: AlertRow[] = s.clearedAlerts.map((a) => ({ id: a.id, accountName: a.accountName, title: a.title, what: "Cleared", at: a.resolvedAt as number, severity: a.severity === "critical" ? "Urgent" : a.severity === "warning" ? "Soon" : "When you can" }));
    return alertsSpec(rows, { key: "since:alerts", title: "Alerts cleared since your last visit", subtitle: `Alerts whose problem went away after ${when} UTC.`, noun: plural(rows.length, "alert"), count: rows.length, exportName: "alerts-cleared" });
  }
  const list = k === "new" ? s.newLeads : k === "breached" ? s.breached : s.answered;
  const title = k === "new" ? "New leads since your last visit" : k === "breached" ? "Leads that passed their reply target since your last visit" : "Leads that got a first reply since your last visit";
  const sub = k === "new" ? `Leads that arrived after ${when} UTC.` : k === "breached" ? `Leads whose ${e.targetMinutes}-minute reply target ran out after ${when} UTC without a reply inside it.` : `Leads whose first reply was sent after ${when} UTC.`;
  return leadsSpec(list, e.now, { key: `since:${k}`, title, subtitle: sub, noun: plural(list.length, "lead"), count: list.length, exportName: `since-${k}` });
}

export function specComing(kind: "leads" | "deals" | "appointments", list: Coming[], targetMinutes: number): RecordsSpec {
  const t = { leads: ["Leads about to pass the reply target", `Leads inside their ${targetMinutes}-minute reply window that nobody has answered. Each one passes the target at the time shown if nobody replies.`, "lead"], deals: ["Deals about to go quiet", "Counted open deals that will have had no movement for the stale days by the time shown, if nobody touches them.", "deal"], appointments: ["Appointments still to happen today", "Appointments that start later today. Each will need an outcome marked afterwards.", "appointment"] }[kind];
  return comingSpec(list, { key: `coming:${kind}`, title: t[0], subtitle: t[1], noun: plural(list.length, t[2]) });
}

export const specHour = hourSpec;
export const specSource = sourceSpec;
export function specPerson(name: string, waiting: TodayItem[], e: SpecEnv): RecordsSpec {
  const items = waitingOf(waiting, name);
  return itemsSpec(items, e.now, { key: `person:${name}`, title: `${name}, leads waiting`, subtitle: `Leads past the ${e.targetMinutes}-minute reply target that ${name === "Nobody assigned" ? "have no owner in the CRM" : `${name} owns in the CRM`}.`, noun: plural(items.length, "lead"), count: items.length, exportName: `leads-${name}` });
}
export function specAccountReplies(locationId: string, name: string, e: SpecEnv): RecordsSpec {
  const rows = answeredLeadsOf(e.ledger, locationId);
  return leadsSpec(rows.map(strip), e.now, { key: `speed:${locationId}`, title: `${name}, first replies`, subtitle: "Leads of the last 14 days that got a first reply. The typical time is the middle one.", noun: plural(rows.length, "reply", "replies"), count: rows.length, exportName: `replies-${name}` });
}
export function specNext(ids: string[], text: string, e: SpecEnv): RecordsSpec {
  const items = e.view.items.filter((i) => ids.includes(i.id));
  return itemsSpec(items, e.now, { key: "next", title: text, subtitle: "The records the suggested step starts with, in the order to take them.", noun: plural(items.length, "thing"), count: items.length, exportName: "next-step" });
}
export function specWhy(text: string, ids: string[], accountName: string, e: SpecEnv): RecordsSpec {
  const items = e.view.items.filter((i) => ids.includes(i.id));
  return itemsSpec(items, e.now, { key: `why:${text}`, title: `${accountName}: ${text}`, subtitle: "What these leads have in common. It does not say why it happened.", noun: plural(items.length, "lead"), count: items.length, exportName: "what-they-share" });
}
export function specJunk(e: SpecEnv): RecordsSpec {
  const items = e.view.junk.items;
  return itemsSpec(items, e.now, { key: "junk", title: "Left out of the dollar figure", subtitle: `Stale deals with a test name, or with no movement for more than ${junkDaysOf(e.staleDays)} days (3 times the stale days). ${money(e.view.junk.dollars)} in all. Switch the control off to count them again.`, noun: plural(items.length, "deal"), count: items.length, exportName: "left-out-deals" });
}

export { leadsInHour, ageWords };
