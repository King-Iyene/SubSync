// The working queue and the junk control of Today. Pure.
//
// A person can press Done, Snooze or Assign to me on a Fix first row. Each press is one append-only event (table today_actions). The events live only in SubSync:
// they never go to the CRM and no metric reads them (what SubSync writes must never change what SubSync measures). This file turns the events into "which items are
// held back right now", and applies them, with the junk control, to Today's items so that every count, the headline, the queue and the charts agree.

import { localClock } from "./digest-intel.ts";
import { isTestName } from "./test-data.ts";
import type { Cell, Col, Rec, RecordsSpec } from "./today-records.ts";
import { trimColumns } from "./today-records.ts";
import { buildQueue, emptyTotals, KIND_LABEL, KINDS, type AccountFacts, type Kind, type QueueRow, type TodayItem, type Totals } from "./today-queue.ts";

const DAY = 86_400_000;

export const ACTIONS = ["done", "snooze", "assign", "undo"] as const;
export type Action = (typeof ACTIONS)[number];
export type ActionEvent = {
  id: number; rowKey: string; locationId: string; kind: Kind; action: Action;
  /** "team" (an agency or a business administrator) or "user:<id>" (a client's staff: their own queue only). */
  lane: string;
  actorKey: string; actorName: string | null; until: number | null; undoes: number | null; itemIds: string[]; at: number;
};

/** Done holds a row back for this many days; if the CRM still shows it wrong after that, it comes back. */
export const DONE_HOLD_DAYS = 7;
/** How long Undo stays offered after a press, in seconds. */
export const UNDO_SECONDS = 10;

export type Hold = { eventId: number; action: "done" | "snooze"; until: number; by: string | null; at: number; rowKey: string };
export type Assignment = { eventId: number; by: string | null; actorKey: string; at: number };

/** The lanes a person reads: a client's staff read only their own; everyone else shares the team's. */
export const lanesFor = (kind: "agency" | "business" | "client", userKey: string): string[] => (kind === "client" ? [`user:${userKey}`] : ["team"]);

/** What Assign to me and the ten-second Undo are offered to: a client's staff may only press Done and Snooze (the server refuses the rest too). */
export const canAssign = (kind: "agency" | "business" | "client") => kind !== "client";

export function resolveEvents(events: ActionEvent[], now: number, lanes: string[]): { holds: Record<string, Hold>; assigned: Record<string, Assignment> } {
  const mine = events.filter((e) => lanes.includes(e.lane)).sort((a, b) => a.at - b.at || a.id - b.id);
  const undone = new Set(mine.filter((e) => e.action === "undo" && e.undoes !== null).map((e) => e.undoes as number));
  const holds: Record<string, Hold> = {};
  const assigned: Record<string, Assignment> = {};
  for (const e of mine) {
    if (e.action === "undo" || undone.has(e.id)) continue;
    if (e.action === "assign") { assigned[e.rowKey] = { eventId: e.id, by: e.actorName, actorKey: e.actorKey, at: e.at }; continue; }
    const until = e.action === "done" ? e.at + DONE_HOLD_DAYS * DAY : e.until;
    if (until === null || until <= now) continue;
    for (const id of e.itemIds) holds[id] = { eventId: e.id, action: e.action, until, by: e.actorName, at: e.at, rowKey: e.rowKey };
  }
  return { holds, assigned };
}

/** "Snooze 1 day" is 24 hours; "until Monday" is the next Monday at 08:00 in the account's own time zone (a zone that cannot be read counts as UTC). */
export type SnoozeChoice = "day" | "monday";
export const isSnoozeChoice = (v: unknown): v is SnoozeChoice => v === "day" || v === "monday";
export function snoozeUntil(choice: SnoozeChoice, now: number, zone: string): number {
  if (choice === "day") return now + DAY;
  const z = localClock(new Date(now), zone) ? zone : "UTC";
  for (let t = now + 15 * 60_000; t <= now + 8 * DAY; t += 15 * 60_000) {
    const c = localClock(new Date(t), z);
    if (c && c.weekday === "Mon" && c.hour === 8) return t - (t % (15 * 60_000));
  }
  return now + 7 * DAY;
}

/**
 * The row key is the client account and the kind: "<locationId>|<kind>". A person on the Reply now list is a row of one: "<locationId>|replies|<person>", where the person is
 * the part of the item id after the account ("replies:<locationId>:<person>"). Anything else is refused; the server looks the items up itself, so a forged person finds nothing.
 */
const LOCATION = /^[A-Za-z0-9_-]{3,64}$/;
const PERSON = /^[^|]{1,200}$/;
export function parseRowKey(key: unknown): { locationId: string; kind: Kind; person: string | null } | null {
  if (typeof key !== "string") return null;
  const [loc, kind, person, extra] = key.split("|");
  if (extra !== undefined || !loc || !LOCATION.test(loc) || !(KINDS as readonly string[]).includes(kind)) return null;
  if (person !== undefined && (kind !== "replies" || !PERSON.test(person))) return null;
  return { locationId: loc, kind: kind as Kind, person: person ?? null };
}
/** The item id a one-person row stands for. */
export const personItemId = (locationId: string, person: string) => `replies:${locationId}:${person}`;

// ---------- junk control ----------

/**
 * "Exclude test and very old deals". A stale deal is left out of the dollar figure when its own name is an obvious test name (the same words the test-account switch
 * uses) or when it has not moved for more than three times the stale-days setting (the largest of the three stale tiers SubSync already keeps, 90 days by default):
 * a deal that quiet is a leftover, not a pipeline to chase. Only stale deals are ever left out, and the panel lists every one with its dollars.
 */
export const JUNK_MULTIPLE = 3;
export const junkDaysOf = (staleDays: number) => staleDays * JUNK_MULTIPLE;
export function isJunk(i: Pick<TodayItem, "kind" | "name" | "at">, junkDays: number, now: number): boolean {
  if (i.kind !== "stale") return false;
  return isTestName(i.name) || (i.at !== null && now - i.at > junkDays * DAY);
}

// ---------- the view: holds and junk applied to the items ----------

export type ViewInput = { items: TodayItem[]; totals: Totals; accounts: AccountFacts[]; staleDays: number; now: number };
export type ViewOpts = { holds: Record<string, Hold>; excludeJunk: boolean };
export type View = {
  items: TodayItem[]; totals: Totals; queue: QueueRow[];
  held: Array<{ item: TodayItem; hold: Hold }>;
  junk: { items: TodayItem[]; dollars: number };
  /** One deal that is at least half of the stalled dollars on screen (the audit's guard), worked out from the deals that are still counted. */
  outlier: { value: number; share: number } | null;
};

/**
 * The items and totals Today shows. An item a person marked Done or snoozed, and (when the control is on) a junk deal, is taken out of the rows, the totals, the
 * queue and so the headline and every chart; the true totals the server counted are reduced by exactly the rows removed, so a capped list stays honest.
 */
export function applyView(i: ViewInput, o: ViewOpts): View {
  const junkDays = junkDaysOf(i.staleDays);
  const held: View["held"] = [];
  const junkItems: TodayItem[] = [];
  const keep: TodayItem[] = [];
  for (const it of i.items) {
    const h = o.holds[it.id];
    if (h) held.push({ item: it, hold: h });
    else if (o.excludeJunk && isJunk(it, junkDays, i.now)) junkItems.push(it);
    else keep.push(it);
  }
  const totals = emptyTotals();
  for (const k of KINDS) {
    const removedHeld = held.filter((x) => x.item.kind === k);
    const removedJunk = junkItems.filter((x) => x.kind === k);
    const removedN = removedHeld.length + removedJunk.length;
    const dollarsOf = (xs: Array<{ value: number | null }>) => xs.reduce((s, x) => s + (x.value ?? 0), 0);
    const removedDollars = dollarsOf(removedHeld.map((x) => x.item)) + dollarsOf(removedJunk);
    const full = i.totals[k];
    const dollars = full.dollars === null ? null : Math.max(0, full.dollars - removedDollars);
    totals[k] = { count: Math.max(0, full.count - removedN), dollars: dollars && dollars > 0 ? dollars : null, shown: keep.filter((x) => x.kind === k).length };
    // Of the people waiting for a reply, the new leads: the true total less the new leads taken out (a subset, so it can never exceed the people shown).
    if (k === "replies") totals[k].newLeads = Math.min(totals[k].count, Math.max(0, (full.newLeads ?? 0) - removedHeld.filter((x) => x.item.newLead).length - removedJunk.filter((x) => x.newLead).length));
  }
  const queue = buildQueue({ items: keep, totals, accounts: new Map(i.accounts.map((a) => [a.id, a])), staleDays: i.staleDays, now: i.now });
  // The audit's outlier guard, on what is still counted: a deal left out as junk or set aside must not be named as "most of that".
  const top = keep.filter((x) => x.kind === "stale" && (x.value ?? 0) > 0).reduce((m, x) => Math.max(m, x.value as number), 0);
  const dollars = totals.stale.dollars ?? 0;
  const outlier = top > 0 && dollars > 0 && top / dollars >= 0.5 ? { value: Math.round(top), share: Math.round((top / dollars) * 100) / 100 } : null;
  return { items: keep, totals, queue, held, junk: { items: junkItems, dollars: junkItems.reduce((s, x) => s + (x.value ?? 0), 0) }, outlier };
}

// ---------- the list behind "N snoozed" ----------

const HELD_COLS: Col[] = [
  { key: "what", header: "What", type: "text", primary: true, w: 14 },
  { key: "account", header: "Client account", type: "text", facet: true, w: 13 },
  { key: "kind", header: "Kind", type: "kind", facet: true, w: 12 },
  { key: "hold", header: "State", type: "kind", facet: true, w: 10 },
  { key: "until", header: "Comes back", type: "date", w: 11 },
  { key: "by", header: "Set aside by", type: "text", facet: true, w: 11 },
  { key: "at", header: "When", type: "date", w: 11 },
  { key: "crm", header: "CRM", type: "link", w: 7 },
];
export function heldSpec(held: View["held"]): RecordsSpec {
  const rows: Rec[] = held.map(({ item: i, hold: h }) => ({
    id: i.id, url: i.url, lead: { contactId: i.contactId, locationId: i.locationId, name: i.name, account: i.accountName, note: i.detail },
    cells: { what: i.name, account: i.accountName, kind: KIND_LABEL[i.kind], hold: h.action === "done" ? "Done" : "Snoozed", until: h.until, by: h.by, at: h.at, crm: i.url } as Record<string, Cell>,
  }));
  return {
    key: "held", title: "Set aside", subtitle: "Marked Done or snoozed in SubSync. They are left out of the headline and the counts, and they come back by themselves. Nothing was changed in your CRM.",
    noun: held.length === 1 ? "item" : "items", count: held.length, cols: trimColumns(HELD_COLS, rows), rows, note: null, dateKey: "at", preset: {}, exportName: "set-aside",
  };
}
