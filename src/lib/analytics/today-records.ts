// The records behind every mark on Today. Pure: no database, no React, so the rule "the number you pressed equals the rows you are shown" can be unit tested.
//
// A RecordsSpec is one table: its title and subtitle in words, typed columns (text, date, number, money, duration, link, kind), the rows and the count that was on the
// thing the person pressed. The panel (src/app/app/ds/records-panel.tsx) draws any spec; it filters, sorts, searches and exports the rows in the browser. Nothing
// here reads the CRM or writes anything. Every row was already sent to a person who may see it (the server limits Today to the accounts of the signed session), so
// filtering and exporting here can only ever narrow what the person already has.

import { ageWords, KIND_LABEL, type TodayItem } from "./today-queue.ts";

export type ColType = "text" | "date" | "number" | "money" | "duration" | "link" | "kind";
export type Col = {
  key: string; header: string; type: ColType;
  /** Can be used as a filter chip (the distinct values are offered). */
  facet?: boolean;
  /** The column that names the row; the row's OPEN button sits here. */
  primary?: boolean;
  /** A width in rem for the table. */
  w?: number;
};
export type Cell = string | number | null;
export type LeadRef = { contactId: string | null; locationId: string; name: string; account: string; note: string };
export type Rec = { id: string; cells: Record<string, Cell>; url: string | null; lead: LeadRef | null };
export type RecordsSpec = {
  /** A stable key for the mark that opened it (tests, and "the same mark pressed again closes it"). */
  key: string;
  title: string; subtitle: string;
  /** "leads", "deals", "accounts": the word after the count. */
  noun: string;
  /** The number that was on the thing the person pressed. The header says it; it equals rows.length unless `note` says the list was cut. */
  count: number;
  cols: Col[]; rows: Rec[];
  /** Said under the table when the list was cut or something was left out, in words. */
  note: string | null;
  /** Which column the date chip filters (null when there is none). */
  dateKey: string | null;
  /** Filter chips that are already on when the panel opens (the click narrowed to them). */
  preset: Record<string, string[]>;
  exportName: string;
};

export const COL_ICON_NAME: Record<ColType, string> = { text: "Aa", date: "date", number: "#", money: "$", duration: "time", link: "link", kind: "kind" };

// ---------- builders ----------

const ITEM_COLS: Col[] = [
  { key: "what", header: "What", type: "text", primary: true, w: 14 },
  { key: "account", header: "Client account", type: "text", facet: true, w: 12 },
  { key: "kind", header: "Kind", type: "kind", facet: true, w: 11 },
  { key: "since", header: "Wrong since", type: "date", w: 10.5 },
  { key: "waiting", header: "For", type: "duration", w: 6 },
  { key: "value", header: "Deal value", type: "money", w: 8 },
  { key: "owner", header: "Owner", type: "text", facet: true, w: 9 },
  { key: "source", header: "Source", type: "text", facet: true, w: 9 },
  { key: "detail", header: "Detail", type: "text", w: 14 },
  { key: "crm", header: "CRM", type: "link", w: 8 },
];

export function itemRec(i: TodayItem, now: number): Rec {
  return {
    id: i.id,
    cells: {
      what: i.name, account: i.accountName, kind: KIND_LABEL[i.kind], since: i.at, waiting: i.at === null ? null : Math.max(0, Math.round((now - i.at) / 60_000)),
      value: i.value, owner: i.owner ?? null, source: i.source ?? null, detail: i.detail, crm: i.url,
    },
    url: i.url, lead: { contactId: i.contactId, locationId: i.locationId, name: i.name, account: i.accountName, note: i.detail },
  };
}

/** Columns with no value in any row are left out, so a one-account list has no Client account column and a lead list has no Deal value. */
export function trimColumns(cols: Col[], rows: Rec[]): Col[] {
  return cols.filter((c) => {
    if (c.primary) return true;
    if (!rows.some((r) => r.cells[c.key] !== null && r.cells[c.key] !== undefined && r.cells[c.key] !== "")) return false;
    // A kind column that says the same thing on every row (the list is already titled "Leads waiting") only costs width.
    if (c.type === "kind" && c.key === "kind" && new Set(rows.map((r) => r.cells[c.key])).size <= 1) return false;
    return true;
  });
}

export type SpecInput = { key: string; title: string; subtitle: string; noun: string; count: number; note?: string | null; preset?: Record<string, string[]>; exportName?: string };

/** The list behind a mark made of Today's items. */
export function itemsSpec(items: TodayItem[], now: number, i: SpecInput): RecordsSpec {
  const rows = items.map((x) => itemRec(x, now));
  const cut = i.count > rows.length;
  return {
    key: i.key, title: i.title, subtitle: i.subtitle, noun: i.noun, count: i.count, cols: trimColumns(ITEM_COLS, rows), rows,
    note: i.note ?? (cut ? `SubSync loaded the first ${rows.length.toLocaleString("en-US")} of ${i.count.toLocaleString("en-US")}. Open the client account to see the rest.` : null),
    dateKey: "since", preset: i.preset ?? {}, exportName: i.exportName ?? i.key,
  };
}

const ACCOUNT_COLS: Col[] = [
  { key: "account", header: "Client account", type: "text", primary: true, w: 16 },
  { key: "state", header: "How urgent", type: "kind", facet: true, w: 12 },
  { key: "things", header: "Things to fix", type: "number", w: 9 },
  { key: "dollars", header: "Stale deal value", type: "money", w: 11 },
  { key: "oldest", header: "Oldest wrong for", type: "duration", w: 11 },
  { key: "reason", header: "Biggest reason", type: "text", w: 24 },
  { key: "crm", header: "CRM", type: "link", w: 7 },
];
export type AccountRow = { locationId: string; name: string; state: string; things: number; dollars: number | null; oldestMinutes: number | null; reason: string; url: string };
/** One row per client account: the list behind "13 clients need you today". */
export function accountsSpec(rows: AccountRow[], i: SpecInput): RecordsSpec {
  const recs: Rec[] = rows.map((a) => ({
    id: `account:${a.locationId}`, url: a.url, lead: null,
    cells: { account: a.name, state: a.state, things: a.things, dollars: a.dollars, oldest: a.oldestMinutes, reason: a.reason, crm: a.url },
  }));
  return { key: i.key, title: i.title, subtitle: i.subtitle, noun: i.noun, count: i.count, cols: trimColumns(ACCOUNT_COLS, recs), rows: recs, note: i.note ?? null, dateKey: null, preset: i.preset ?? {}, exportName: i.exportName ?? i.key };
}

const ALERT_COLS: Col[] = [
  { key: "account", header: "Client account", type: "text", primary: true, facet: true, w: 14 },
  { key: "title", header: "Alert", type: "text", w: 26 },
  { key: "what", header: "What happened", type: "kind", facet: true, w: 11 },
  { key: "when", header: "When", type: "date", w: 11 },
  { key: "severity", header: "How serious", type: "kind", facet: true, w: 10 },
];
export type AlertRow = { id: string; accountName: string; title: string; what: "Raised" | "Cleared"; at: number; severity: string };
/** Alerts raised or cleared: the list behind a day of the raised and cleared strip, or behind "Raised 14". */
export function alertsSpec(rows: AlertRow[], i: SpecInput): RecordsSpec {
  const recs: Rec[] = rows.map((a) => ({ id: `${a.id}:${a.what}`, url: null, lead: null, cells: { account: a.accountName, title: a.title, what: a.what, when: a.at, severity: a.severity } }));
  return { key: i.key, title: i.title, subtitle: i.subtitle, noun: i.noun, count: i.count, cols: ALERT_COLS, rows: recs, note: i.note ?? null, dateKey: "when", preset: i.preset ?? {}, exportName: i.exportName ?? i.key };
}

export type LedgerLead = {
  id: string; locationId: string; accountName: string; contactId: string; name: string; source: string | null; ownerName: string | null; touchBy: string | null;
  leadAt: number; touchAt: number | null; url: string;
};
const LEAD_COLS: Col[] = [
  { key: "what", header: "Lead", type: "text", primary: true, w: 15 },
  { key: "account", header: "Client account", type: "text", facet: true, w: 13 },
  { key: "source", header: "Source", type: "text", facet: true, w: 11 },
  { key: "since", header: "Arrived", type: "date", w: 11 },
  { key: "reply", header: "First reply after", type: "duration", w: 10 },
  { key: "by", header: "Replied by", type: "text", facet: true, w: 11 },
  { key: "owner", header: "Owner", type: "text", facet: true, w: 10 },
  { key: "crm", header: "CRM", type: "link", w: 7 },
];
/** Leads from the last 14 days with how long the first reply took (empty when nobody replied yet): behind an hour, a source or an account of the strips. */
export function leadsSpec(leads: LedgerLead[], now: number, i: SpecInput): RecordsSpec {
  const recs: Rec[] = leads.map((l) => ({
    id: l.id, url: l.url,
    lead: { contactId: l.contactId, locationId: l.locationId, name: l.name, account: l.accountName, note: l.touchAt === null ? "Not answered yet" : `First reply after ${ageWords((l.touchAt - l.leadAt) / 60_000)}` },
    cells: {
      what: l.name, account: l.accountName, source: l.source, since: l.leadAt, reply: l.touchAt === null ? null : Math.max(0, Math.round((l.touchAt - l.leadAt) / 60_000)),
      by: l.touchBy, owner: l.ownerName, crm: l.url,
    },
  }));
  void now;
  return { key: i.key, title: i.title, subtitle: i.subtitle, noun: i.noun, count: i.count, cols: trimColumns(LEAD_COLS, recs), rows: recs, note: i.note ?? null, dateKey: "since", preset: i.preset ?? {}, exportName: i.exportName ?? i.key };
}

// ---------- filtering, searching, sorting ----------

export type RecFilter = {
  /** Column key to the values that are allowed (empty or missing means every value). */
  facets: Record<string, string[]>;
  range: { from: number | null; to: number | null } | null;
  q: string;
};
export const emptyFilter = (preset: Record<string, string[]> = {}): RecFilter => ({ facets: { ...preset }, range: null, q: "" });
const NONE = "(none)";
export const NO_VALUE = NONE;
const text = (c: Cell): string => (c === null || c === undefined || c === "" ? NONE : String(c));

export function searchHaystack(cols: Col[], r: Rec): string {
  return cols.filter((c) => c.type !== "link").map((c) => (typeof r.cells[c.key] === "string" ? (r.cells[c.key] as string) : "")).join(" \n ").toLowerCase();
}

export function filterRecs(spec: Pick<RecordsSpec, "cols" | "rows" | "dateKey">, f: RecFilter): Rec[] {
  const q = f.q.trim().toLowerCase();
  return spec.rows.filter((r) => {
    for (const [key, allowed] of Object.entries(f.facets)) {
      if (allowed.length === 0) continue;
      if (!allowed.includes(text(r.cells[key]))) return false;
    }
    if (f.range && spec.dateKey) {
      const v = r.cells[spec.dateKey];
      if (typeof v !== "number") return false;
      if (f.range.from !== null && v < f.range.from) return false;
      if (f.range.to !== null && v > f.range.to) return false;
    }
    return q === "" || searchHaystack(spec.cols, r).includes(q);
  });
}

export function facetValues(rows: Rec[], key: string): Array<{ value: string; n: number }> {
  const m = new Map<string, number>();
  for (const r of rows) m.set(text(r.cells[key]), (m.get(text(r.cells[key])) ?? 0) + 1);
  return [...m.entries()].map(([value, n]) => ({ value, n })).sort((a, b) => b.n - a.n || a.value.localeCompare(b.value));
}

export type Sort = { key: string; dir: "asc" | "desc" } | null;
export function sortRecs(rows: Rec[], s: Sort): Rec[] {
  if (!s) return rows;
  const sign = s.dir === "asc" ? 1 : -1;
  // A missing value always sorts last, whichever way the column is sorted.
  return [...rows].sort((a, b) => {
    const x = a.cells[s.key] ?? null, y = b.cells[s.key] ?? null;
    if (x === null && y === null) return 0;
    if (x === null) return 1;
    if (y === null) return -1;
    return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "en", { numeric: true, sensitivity: "base" })) * sign;
  });
}

/** The ranges the date chip offers. */
export type RangeChoice = { id: string; label: string; from: number | null; to: number | null };
export function rangeChoices(now: number): RangeChoice[] {
  const H = 3_600_000, D = 24 * H;
  return [
    { id: "any", label: "Any time", from: null, to: null },
    { id: "24h", label: "Last 24 hours", from: now - D, to: null },
    { id: "7d", label: "Last 7 days", from: now - 7 * D, to: null },
    { id: "14d", label: "Last 14 days", from: now - 14 * D, to: null },
    { id: "old7", label: "Older than 7 days", from: null, to: now - 7 * D },
    { id: "old30", label: "Older than 30 days", from: null, to: now - 30 * D },
  ];
}

// ---------- CSV ----------

/** A cell as a person would read it in a spreadsheet. A date is a date and time, a duration is in words. */
export function cellText(c: Col, v: Cell, zone = "UTC"): string {
  if (v === null || v === undefined || v === "") return "";
  if (c.type === "date" && typeof v === "number") {
    try { return new Date(v).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: zone }); } catch { return new Date(v).toISOString(); }
  }
  if (c.type === "duration" && typeof v === "number") return ageWords(v);
  if (c.type === "money" && typeof v === "number") return "$" + Math.round(v).toLocaleString("en-US");
  return String(v);
}

/** A spreadsheet runs a cell that starts with = + - or @ as a formula; a leading apostrophe makes it plain text. Quotes, commas and line breaks are escaped. */
export function csvCell(s: string): string {
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** Exactly the columns shown and the rows after filtering and sorting; nothing else leaves the page. */
export function toCsv(cols: Col[], rows: Rec[], zone = "UTC"): string {
  const head = cols.map((c) => csvCell(c.header)).join(",");
  return [head, ...rows.map((r) => cols.map((c) => csvCell(cellText(c, r.cells[c.key] ?? null, zone))).join(","))].join("\r\n") + "\r\n";
}
