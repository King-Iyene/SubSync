// The records behind every number and mark on the Growth tab. Pure, so "the number you pressed equals the rows you are shown" is unit tested
// (src/lib/__tests__/growth-records.test.ts). Every row came from the person's own read (the server limits Growth to the client accounts they may see).

import { sourceLabel } from "./speed-intel.ts";
import { trimColumns, type Col, type Rec, type RecordsSpec } from "./today-records.ts";
import { VERDICT_WORD, type GrowthData, type GrowthRecord, type Period, type Verdict } from "./growth.ts";

const DAY = 86_400_000;
const COLS: Col[] = [
  { key: "who", header: "Person", type: "text", primary: true, w: 13 },
  { key: "email", header: "Email", type: "text", w: 15 },
  { key: "account", header: "Client", type: "text", facet: true, w: 12 },
  { key: "source", header: "Source", type: "text", facet: true, w: 10 },
  { key: "added", header: "Added", type: "date", w: 10.5 },
  { key: "why", header: "Why it is not counted", type: "kind", facet: true, w: 11 },
  { key: "crm", header: "CRM", type: "link", w: 7 },
];

const recOf = (r: GrowthRecord): Rec => ({
  id: r.id, url: r.url || null,
  cells: { who: r.name, email: r.email, account: r.accountName, source: r.source ? sourceLabel(r.source) : "No source recorded", added: r.at, why: r.verdict === "counted" ? null : VERDICT_WORD[r.verdict as Exclude<Verdict, "counted" | "no_email">], crm: r.url || null },
  lead: { contactId: r.id.slice(r.locationId.length + 1), locationId: r.locationId, name: r.name, account: r.accountName, note: r.email },
});

type Info = { key: string; title: string; subtitle: string; noun?: string; count: number; note?: string | null };
function specOf(list: GrowthRecord[], i: Info): RecordsSpec {
  const rows = list.map(recOf);
  const cut = i.count > rows.length;
  return {
    key: i.key, title: i.title, subtitle: i.subtitle, noun: i.noun ?? (rows.length === 1 ? "lead" : "leads"), count: i.count, cols: trimColumns(COLS, rows), rows,
    note: i.note ?? (cut ? `SubSync loaded the ${rows.length.toLocaleString("en-US")} newest of ${i.count.toLocaleString("en-US")}. Open the client to see the rest.` : null),
    dateKey: "added", preset: {}, exportName: i.key,
  };
}
const counted = (d: GrowthData) => d.records.filter((r) => r.verdict === "counted");
const PERIOD_WORD: Record<Period, string> = { today: "today", week: "this week", month: "this month", all: "all time" };
const PERIOD_SUB: Record<Period, string> = {
  today: "New email leads since midnight, one per person, in each client's own time.", week: "New email leads since Monday, one per person.",
  month: "New email leads since the 1st of the month, one per person.", all: "Every email lead SubSync holds, one per person, newest first.",
};

/** Today, this week, this month, or all time. */
export function specPeriod(d: GrowthData, p: Period, locationId?: string): RecordsSpec {
  const pick = (r: GrowthRecord) => (locationId ? r.locationId === locationId : true);
  if (p === "all") {
    const list = d.recentAll.filter(pick);
    return specOf(list, { key: `growth-all${locationId ? `-${locationId}` : ""}`, title: "Email leads, all time", subtitle: PERIOD_SUB.all, count: locationId ? list.length : d.changes.all.count });
  }
  const list = counted(d).filter((r) => r[p] && pick(r));
  const count = locationId ? list.length : d.changes[p].count;
  const who = locationId ? ` for ${d.league.find((l) => l.locationId === locationId)?.name ?? "this client"}` : "";
  return specOf(list, { key: `growth-${p}${locationId ? `-${locationId}` : ""}`, title: `Email leads ${PERIOD_WORD[p]}${who}`, subtitle: PERIOD_SUB[p], count });
}

const inRange = (d: GrowthData, at: number) => at >= d.range.start && at < d.range.end;
/** Everyone counted in the chosen dates (the big counter). */
export function specRange(d: GrowthData): RecordsSpec {
  const list = counted(d).filter((r) => inRange(d, r.at));
  return specOf(list, { key: "growth-range", title: `Email leads, ${d.range.label.toLowerCase()}`, subtitle: `New email leads added ${d.range.from} to ${d.range.to}, one per person.`, count: d.range.count });
}

/** One day of the chart. */
export function specDay(d: GrowthData, day: string): RecordsSpec {
  const list = counted(d).filter((r) => r.day === day);
  const point = d.series.find((p) => p.day === day);
  return specOf(list, { key: `growth-day-${day}`, title: `Email leads on ${point?.label ?? day}`, subtitle: "New email leads added that day, one per person.", count: point?.count ?? list.length });
}

/** The records that were taken out of the count, all of them or one reason. */
export function specRemoved(d: GrowthData, why: "duplicate" | "junk" | "staff" | "role" | "all"): RecordsSpec {
  const list = d.records.filter((r) => r.verdict !== "counted" && (why === "all" || r.verdict === why));
  const word = why === "all" ? "left out of the count" : why === "duplicate" ? "that were extra copies of a person" : why === "junk" ? "that look like test or junk records" : why === "staff" ? "from your own staff addresses" : "from shared mailboxes such as info@";
  return specOf(list, { key: `growth-removed-${why}`, title: `Sign ups ${word}`, subtitle: `Records with an email added ${d.range.from} to ${d.range.to}, with the reason each was not counted.`, noun: list.length === 1 ? "sign up" : "sign ups", count: why === "all" ? Object.values(d.gross.removed).reduce((s, n) => s + n, 0) : d.gross.removed[why] });
}

/** Everything with an email in the last 30 days, counted or not (the "sign ups" figure). */
export function specSignUps(d: GrowthData): RecordsSpec {
  return specOf(d.records, { key: "growth-signups", title: `Sign ups with an email, ${d.range.label.toLowerCase()}`, subtitle: `Every record with an email added ${d.range.from} to ${d.range.to}, with the reason for those that were not counted.`, noun: "sign ups", count: d.gross.signUps });
}

/** One source of the last 30 days. */
export function specSource(d: GrowthData, source: string): RecordsSpec {
  const list = counted(d).filter((r) => inRange(d, r.at) && sourceLabel(r.source) === source);
  const row = d.mix.rows.find((r) => r.source === source);
  return specOf(list, { key: `growth-source-${source.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, title: `Email leads from ${source}, ${d.range.label.toLowerCase()}`, subtitle: "One per person, newest first.", count: row?.count ?? list.length });
}
