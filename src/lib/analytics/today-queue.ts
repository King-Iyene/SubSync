// Today, rebuilt (the outcome-first front door). Pure: no database, no React, so every sentence, every ranking and every chart number on Today can be unit tested.
//
// Nothing here measures anything new. Every figure is one SubSync already shows on its own page, under its existing definition (docs/METRICS.md):
//   waiting for a reply  Speed to lead (a new lead past its reply target with no person's reply) and the Account audit's waiting conversations, counted ONCE per person
//   appointments         Appointments (past, no outcome marked) and no-shows not rebooked
//   deals gone quiet     the Account audit (counted open deals, no movement for the stale days, dollars from the deal values)
// What this file adds is the order things are listed in, the sentences, the shares behind the charts and the "vs your usual" comparisons.

import { MIN_FOR_MEDIAN } from "./speed-intel.ts";

// The counting rule (docs/METRICS.md, "Today, third pass"): a person is counted ONCE for "waiting for a reply". A new lead nobody answered and a customer message nobody
// answered are the same person waiting, so they are ONE kind ("replies"); "new leads among them" is a subset that is said, never added. Appointments to mark, no-shows to
// win back and deals gone quiet are different problems and stay separate kinds.
export const KINDS = ["replies", "appointments", "noshows", "stale"] as const;
export type Kind = (typeof KINDS)[number];

/** Plain names for each kind, as the list, the bars and the records panel say them. */
export const KIND_LABEL: Record<Kind, string> = {
  replies: "Needs a reply", appointments: "Needs an outcome", noshows: "No-shows to rebook", stale: "Quiet deals",
};
/** One colour per KIND, the same everywhere on the page (the validated categorical chart tokens, in order). Status colours are never used for a kind. */
export const KIND_CHART: Record<Kind, 1 | 2 | 3 | 4> = { replies: 1, appointments: 2, noshows: 3, stale: 4 };
export const kindColour = (k: Kind) => `var(--chart-${KIND_CHART[k]})`;

export type TodayItem = {
  id: string; kind: Kind; locationId: string; accountName: string;
  /** The lead, deal or contact the row is about. */
  name: string; detail: string;
  /** Epoch ms since when it has been wrong (the lead arrived, the appointment started, the deal last moved). Null when unknown. */
  at: number | null;
  /** Counted dollars (a deal's value). Null for everything that is not a deal. */
  value: number | null;
  contactId: string | null; url: string;
  /** A lead nobody answered in days. */
  never?: boolean;
  /** The contact asked not to be contacted: never offered as a call. */
  dnd?: boolean; hasPhone?: boolean;
  /** A waiting person who is also a new lead (a SUBSET of the people waiting, never added to them). Only "replies" items carry it. */
  newLead?: boolean;
  /** Who owns the lead in the CRM (a name), and where it came from. Only leads carry them today; both stay null when the CRM does not say. */
  owner?: string | null; source?: string | null;
};

export type KindTotal = { count: number; dollars: number | null; /** Rows actually sent (a cap); count is the true number. */ shown: number; /** Of the people waiting for a reply, how many are new leads. A subset of count. */ newLeads?: number };
export type Totals = Record<Kind, KindTotal>;
export const emptyTotals = (): Totals => Object.fromEntries(KINDS.map((k) => [k, { count: 0, dollars: null, shown: 0 }])) as Totals;

export type Severity = "critical" | "warning" | "info";
const SEVERITY_RANK: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };

export type AccountFacts = { id: string; name: string; /** The existing slow-follow-up estimate for this account (conversations waiting x average deal x win rate), or null. */ followUpEstimate: number | null; url: string };

export type QueueRow = {
  key: string; kind: Kind; locationId: string; accountName: string;
  /** What is wrong, in six to ten words. */
  text: string;
  count: number;
  /** Counted dollars at stake (stale deal values). Null when the row has none. */
  dollars: number | null;
  /** The existing estimate, labelled as one wherever it is shown. Only the waiting-for-a-reply row has one. */
  estimate: number | null;
  /** Since when it has been wrong. */
  since: number | null; ageMinutes: number;
  severity: Severity;
  /** Where the primary button goes: the oldest item's CRM page, or the account's deals page. */
  url: string;
  /** The rows behind this row. */
  itemIds: string[];
  /** The list behind the row was cut: the count shown is of the rows sent. */
  partial: boolean;
};

const plural = (n: number, one: string, many = one + "s") => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
export const money = (n: number) => "$" + Math.round(n).toLocaleString("en-US");

/** The words for how long, as a person would say it: "12 min", "3 h", "2 days". */
export function ageWords(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} min`;
  if (m < 600) return m % 60 === 0 ? `${m / 60} h` : `${Math.floor(m / 60)} h ${m % 60} min`;
  if (m < 48 * 60) return `${Math.round(m / 60)} h`;
  return `${Math.round(m / 1440)} days`;
}

/** What to do about a group, verb first: "Reply to 13 people", "Rebook 3 no-shows", "Mark 2 appointments", "Review 2 quiet deals". */
export function actionTitle(kind: Kind, count: number): string {
  const n = count.toLocaleString("en-US");
  switch (kind) {
    case "replies": return count === 1 ? "Reply to 1 person" : `Reply to ${n} people`;
    case "appointments": return `Mark ${n} ${count === 1 ? "appointment" : "appointments"}`;
    case "noshows": return `Rebook ${n} ${count === 1 ? "no-show" : "no-shows"}`;
    case "stale": return `Review ${n} quiet ${count === 1 ? "deal" : "deals"}`;
  }
}

/** Six to ten words about what is wrong with this group. */
export function rowText(kind: Kind, count: number, staleDays: number): string {
  switch (kind) {
    case "replies": return count === 1 ? "1 person needs a reply" : `${plural(count, "person", "people")} need a reply`;
    case "appointments": return count === 1 ? "1 appointment is over with no outcome" : `${plural(count, "appointment")} are over with no outcome`;
    case "noshows": return `${plural(count, "no-show")} from the last 14 days not rebooked`;
    case "stale": void staleDays; return count === 1 ? "1 open deal has gone quiet" : `${plural(count, "open deal")} have gone quiet`;
  }
}

/** Severity of one group. Thresholds are written in docs/METRICS.md. "Urgent" is rare on purpose so a list is not a wall of red: a reply is urgent only when the oldest wait is 4 hours or more, or 10 or more people are waiting; deals gone quiet only at 25 or more; everything else past its limit is "Soon". */
/** A person who has waited this long for a reply is "Urgent" (4 hours). */
export const URGENT_WAIT_MINUTES = 240;
export function severityOf(kind: Kind, count: number, ageMinutes: number, never: boolean): Severity {
  void never;
  switch (kind) {
    case "replies": return ageMinutes >= URGENT_WAIT_MINUTES || count >= 10 ? "critical" : "warning";
    case "stale": return count >= 25 ? "critical" : "warning";
    case "noshows": return "warning";
    case "appointments": return count >= 5 ? "warning" : "info";
  }
}

export type QueueInput = { items: TodayItem[]; totals: Totals; accounts: Map<string, AccountFacts>; staleDays: number; now: number };

/** One row per (client account, kind). The count is the number of rows behind it, so the row and its list cannot disagree. */
export function buildQueue(i: QueueInput): QueueRow[] {
  const groups = new Map<string, TodayItem[]>();
  for (const it of i.items) {
    const k = `${it.locationId}|${it.kind}`;
    groups.set(k, [...(groups.get(k) ?? []), it]);
  }
  const rows: QueueRow[] = [];
  for (const [key, items] of groups) {
    const first = items[0];
    const kind = first.kind;
    const withAt = items.filter((x) => x.at !== null).sort((a, b) => (a.at as number) - (b.at as number));
    const oldest = withAt[0] ?? first;
    const since = oldest.at;
    const ageMinutes = since === null ? 0 : Math.max(0, Math.round((i.now - since) / 60_000));
    const counted = items.filter((x) => x.value !== null && x.value > 0);
    const dollars = kind === "stale" ? counted.reduce((s, x) => s + (x.value as number), 0) : null;
    const acct = i.accounts.get(first.locationId);
    rows.push({
      key, kind, locationId: first.locationId, accountName: first.accountName, text: rowText(kind, items.length, i.staleDays), count: items.length,
      dollars: dollars && dollars > 0 ? dollars : null, estimate: kind === "replies" ? acct?.followUpEstimate ?? null : null,
      since, ageMinutes, severity: severityOf(kind, items.length, ageMinutes, items.some((x) => x.never === true)),
      url: kind === "stale" ? acct?.url ?? oldest.url : oldest.url, itemIds: items.map((x) => x.id),
      partial: i.totals[kind].count > i.totals[kind].shown,
    });
  }
  return rankQueue(rows);
}

/** The value at risk used to rank: counted dollars, else the existing estimate, else nothing. */
export const valueAtRisk = (r: Pick<QueueRow, "dollars" | "estimate">): number => r.dollars ?? r.estimate ?? 0;

/**
 * The ranking rule (docs/METRICS.md, "The Fix first queue"): value at risk first (largest first), then how long it has been wrong (longest first), then severity
 * (critical before warning before info), then the account name and the kind so the order never flickers between two reads.
 */
export function rankQueue(rows: QueueRow[]): QueueRow[] {
  return [...rows].sort((a, b) =>
    valueAtRisk(b) - valueAtRisk(a) || b.ageMinutes - a.ageMinutes || SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]
    || a.accountName.localeCompare(b.accountName) || a.kind.localeCompare(b.kind));
}

// ---------- the counting rule: ONE function behind every number ----------

/** No list on Today shows more than this many rows inline; the rest is behind one "See all N" that opens the full list in the records panel (50 a page). */
export const INLINE_ROWS = 5;

/** A new lead that nobody on the team has answered (Speed to lead's waiting list). */
export type WaitingLead = { locationId: string; accountName: string; contactId: string; name: string; at: number; never: boolean; url: string; owner: string | null; source: string | null; detail: string };
/** A conversation whose last message is the customer's and which nobody has answered (the Account audit's waiting list). The contact may be unknown (""). */
export type WaitingConversation = { id: string; locationId: string; accountName: string; contactId: string; name: string; at: number | null; url: string; detail: string };

/**
 * People waiting for a reply, each counted ONCE. A new lead nobody answered is usually also a conversation nobody answered (two lists describing one person), so the two
 * lists are merged by contact: a person in both is one row, marked as a new lead; a person in more than one conversation is one row (the oldest wait). The count is the number
 * of distinct people. When a list was cut at its cap the part that was not loaded cannot be matched, so the count then adds what is missing from each list (an upper bound)
 * and `partial` says so. Nothing else on Today counts these people: the headline, the tiles, the work list, the bars and every list behind a number read what this returns.
 */
export function mergeReplies(i: { leads: WaitingLead[]; leadsTotal: number; conversations: WaitingConversation[]; conversationsTotal: number }): { items: TodayItem[]; count: number; newLeads: number; partial: boolean } {
  const byPerson = new Map<string, TodayItem>();
  const key = (loc: string, contact: string, fallback: string) => `${loc}:${contact || fallback}`;
  const earlier = (a: number | null, b: number | null) => (a === null ? b : b === null ? a : Math.min(a, b));
  for (const l of i.leads) {
    const k = key(l.locationId, l.contactId, l.name);
    const had = byPerson.get(k);
    byPerson.set(k, {
      id: `replies:${k}`, kind: "replies", locationId: l.locationId, accountName: l.accountName, name: l.name, detail: l.detail, at: earlier(had?.at ?? null, l.at), value: null,
      contactId: l.contactId || null, url: l.url, never: l.never || had?.never === true, owner: l.owner, source: l.source, newLead: true,
    });
  }
  for (const c of i.conversations) {
    const k = key(c.locationId, c.contactId, `conversation-${c.id}`);
    const had = byPerson.get(k);
    if (had) { had.at = earlier(had.at, c.at); continue; }
    byPerson.set(k, { id: `replies:${k}`, kind: "replies", locationId: c.locationId, accountName: c.accountName, name: c.name, detail: c.detail, at: c.at, value: null, contactId: c.contactId || null, url: c.url, newLead: false });
  }
  const items = [...byPerson.values()];
  const missingLeads = Math.max(0, i.leadsTotal - i.leads.length);
  const missingConversations = Math.max(0, i.conversationsTotal - i.conversations.length);
  const newLeads = items.filter((x) => x.newLead).length + missingLeads;
  return { items, count: items.length + missingLeads + missingConversations, newLeads, partial: missingLeads + missingConversations > 0 };
}

export type Counts = {
  /** People waiting for a reply, each once. */
  replies: number; /** Of those, how many are new leads. Never added to replies. */ newLeads: number;
  appointments: number; noshows: number; stale: number; staleDollars: number;
  /** Every kind added up. Because a person waiting is one kind, no person is in it twice. */
  things: number; /** Client accounts with at least one row on the list. */ accounts: number;
};
/** THE counting function. Every number on Today (headline, tiles, work list, bars, the lists behind them, the brief, the share text) is read from here. */
export function countsOf(totals: Totals, rows: Pick<QueueRow, "locationId">[]): Counts {
  const things = KINDS.reduce((s, k) => s + totals[k].count, 0);
  return {
    replies: totals.replies.count, newLeads: Math.min(totals.replies.count, totals.replies.newLeads ?? 0), appointments: totals.appointments.count, noshows: totals.noshows.count,
    stale: totals.stale.count, staleDollars: totals.stale.dollars ?? 0, things, accounts: new Set(rows.map((r) => r.locationId)).size,
  };
}

// ---------- scoping: the account selector and the clicked kind ----------

export type TodayScope = { accounts: string[]; kind: Kind | null };

/** The rows that fall inside what the person picked. Empty accounts means all of them. */
export function scopeRows<T extends { locationId: string; kind: Kind }>(rows: T[], s: TodayScope): T[] {
  const picked = new Set(s.accounts);
  return rows.filter((r) => (picked.size === 0 || picked.has(r.locationId)) && (s.kind === null || r.kind === s.kind));
}

/** Totals recomputed from the rows that are inside the picked accounts (the count on a slice is the number of rows in its list). */
export function totalsOf(items: TodayItem[], full: Totals, accounts: string[]): Totals {
  const picked = new Set(accounts);
  const out = emptyTotals();
  const narrowed = picked.size > 0;
  for (const k of KINDS) {
    const mine = items.filter((x) => x.kind === k && (!narrowed || picked.has(x.locationId)));
    const dollars = k === "stale" ? mine.reduce((s, x) => s + (x.value ?? 0), 0) : 0;
    // With every account in, the true total (which may exceed the rows sent) is kept; once narrowed, the total is the rows of those accounts.
    out[k] = narrowed ? { count: mine.length, dollars: dollars > 0 ? dollars : null, shown: mine.length, ...(k === "replies" ? { newLeads: mine.filter((x) => x.newLead).length } : {}) } : { ...full[k], shown: mine.length };
  }
  return out;
}

const ID = /^[A-Za-z0-9_-]{3,64}$/;
/** Today's own account choice in the address: `#today?ta=<id>,<id>`. Anything that is not a well-formed id is dropped; the server drops the rest. */
export function parseTodayAccounts(hash: string): string[] {
  const q = hash.indexOf("?");
  if (q === -1) return [];
  const v = new URLSearchParams(hash.slice(q + 1)).get("ta");
  return v ? [...new Set(v.split(",").filter((x) => ID.test(x)))].slice(0, 50) : [];
}
/** The address with Today's account choice set (or removed), keeping every other part. */
export function withTodayAccounts(hash: string, ids: string[]): string {
  const q = hash.indexOf("?");
  const head = q === -1 ? hash : hash.slice(0, q);
  const p = new URLSearchParams(q === -1 ? "" : hash.slice(q + 1));
  const clean = [...new Set(ids.filter((x) => ID.test(x)))].slice(0, 50);
  if (clean.length) p.set("ta", clean.join(",")); else p.delete("ta");
  const rest = p.toString().replace(/%2C/gi, ",");
  return `${head || "#today"}${rest ? `?${rest}` : ""}`;
}
/** The query the server reads (the same `accounts=` every read already honours). */
export const accountsQuery = (ids: string[]) => (ids.length ? `accounts=${ids.filter((x) => ID.test(x)).join(",")}` : "");

// ---------- the headline ----------

/** A strong part of the headline is a button: it opens the records behind that number. */
export type HeadlineAction = "clients" | "dollars" | "things" | "replies";
export type HeadlinePart = { t: string; strong?: boolean; action?: HeadlineAction };
export type Headline = { /** One deal that is most of the quiet-deal money, said in words so the dollar figure is not read as a pattern. Shown beside the dollars (tile, email, print). */ note?: string | null; parts: HeadlinePart[]; text: string; allClear: boolean; /** "8 people waiting for a reply (3 new leads), 6 appointments to mark and 9 deals gone quiet worth $48,200." */ breakdown: string | null; accounts: number; dollars: number };

/** "1 person waiting for a reply", "14 people waiting for a reply": a count with the right singular or plural, as a person would say it. */
export const countWords = (k: Kind, n: number) => `${n.toLocaleString("en-US")} ${COUNT_WORDS[k][n === 1 ? 0 : 1]}`;
const COUNT_WORDS: Record<Kind, [string, string]> = {
  replies: ["person needs a reply", "people need a reply"], appointments: ["appointment with no outcome", "appointments with no outcome"], noshows: ["no-show not rebooked", "no-shows not rebooked"],
  stale: ["quiet deal", "quiet deals"],
};

export function breakdownOf(t: Totals, o: { dollars?: boolean } = {}): string | null {
  const c = countsOf(t, []);
  // The headline already says how many people need a reply; this line adds how many are new leads, then the other kinds in plain words.
  const n = (x: number) => x.toLocaleString("en-US");
  const bits: string[] = [];
  if (c.replies > 0 && c.newLeads > 0) bits.push(`${n(c.newLeads)} new ${c.newLeads === 1 ? "lead" : "leads"}`);
  if (t.appointments.count > 0) bits.push(`${n(t.appointments.count)} ${t.appointments.count === 1 ? "needs" : "need"} an outcome`);
  if (t.noshows.count > 0) bits.push(`${n(t.noshows.count)} ${t.noshows.count === 1 ? "no-show" : "no-shows"} to rebook`);
  if (t.stale.count > 0) bits.push(`${n(t.stale.count)} quiet ${t.stale.count === 1 ? "deal" : "deals"}${t.stale.dollars && o.dollars ? ` worth ${money(t.stale.dollars)}` : ""}`);
  if (bits.length === 0) return null;
  return `${bits.join(", ")}.`;
}

/**
 * The one big sentence. All client accounts: "4 clients need you today. $48,200 is at risk." One account: "8 people are waiting for a reply." (the thing to do first), else
 * "3 things need you today." The numbers come from countsOf, the one counting function. With nothing to do it says so plainly.
 */
export function headlineOf(i: { scope: "all" | "account"; rows: QueueRow[]; totals: Totals; /** One deal that is most of the stalled money (the audit's outlier guard). */ outlier?: { value: number; share: number } | null }): Headline {
  const c = countsOf(i.totals, i.rows);
  const accounts = c.accounts;
  const dollars = c.staleDollars;
  // The sentence carries the one number that matters most (people waiting). The line under it carries the rest, the dollars included.
  const breakdown = breakdownOf(i.totals, { dollars: true });
  const note = i.outlier && dollars > 0 ? `One deal is ${money(i.outlier.value)} of the quiet-deal money.` : null;
  const replyClients = new Set(i.rows.filter((r) => r.kind === "replies").map((r) => r.locationId)).size;
  if (c.things === 0) {
    const text = i.scope === "all" ? "Every client is on track today." : "You are all caught up today.";
    return { parts: [{ t: text }], text, allClear: true, breakdown: null, note: null, accounts: 0, dollars: 0 };
  }
  const replyWord = c.replies === 1 ? "person is" : "people are";
  const parts: HeadlinePart[] = i.scope === "all"
    ? (c.replies > 0
      ? [{ t: c.replies.toLocaleString("en-US"), strong: true, action: "replies" }, { t: ` ${replyWord} waiting for a reply across ` }, { t: String(replyClients), strong: true, ...(replyClients === accounts ? { action: "clients" as const } : {}) }, { t: ` ${replyClients === 1 ? "client" : "clients"}.` }]
      : [{ t: String(accounts), strong: true, action: "clients" }, { t: ` ${accounts === 1 ? "client has" : "clients have"} something to do today.` }])
    : c.replies > 0
      ? [{ t: c.replies.toLocaleString("en-US"), strong: true, action: "replies" }, { t: ` ${replyWord} waiting for a reply.` }]
      : [{ t: c.things.toLocaleString("en-US"), strong: true, action: "things" }, { t: ` ${c.things === 1 ? "thing needs" : "things need"} a look today.` }];
  return { parts, text: parts.map((p) => p.t).join(""), allClear: false, breakdown, note, accounts, dollars };
}

// ---------- the donut ----------

export type Slice = { kind: Kind; label: string; count: number; share: number; dollars: number | null; /** True when the list behind the slice was cut. */ partial: boolean };

/** The slices of "What needs attention": one per kind with something in it, largest first never (the fixed order keeps a kind in the same place). Shares sum to 100. */
export function slicesOf(t: Totals): Slice[] {
  const present = KINDS.filter((k) => t[k].count > 0);
  const total = present.reduce((s, k) => s + t[k].count, 0);
  if (total === 0) return [];
  // Largest remainder rounding, so the shares printed on the slices add up to 100.
  const raw = present.map((k) => (t[k].count / total) * 100);
  const floor = raw.map(Math.floor);
  let left = 100 - floor.reduce((s, x) => s + x, 0);
  const order = raw.map((r, idx) => ({ idx, rem: r - Math.floor(r) })).sort((a, b) => b.rem - a.rem);
  for (const o of order) { if (left <= 0) break; floor[o.idx] += 1; left -= 1; }
  return present.map((k, idx) => ({ kind: k, label: KIND_LABEL[k], count: t[k].count, share: floor[idx], dollars: t[k].dollars, partial: t[k].count > t[k].shown }));
}

/** The title of the donut states the finding. */
export function donutTitle(t: Totals): string {
  const s = slicesOf(t);
  if (s.length === 0) return "Nothing needs attention right now";
  const top = [...s].sort((a, b) => b.count - a.count)[0];
  const total = s.reduce((x, y) => x + y.count, 0);
  return `${total.toLocaleString("en-US")} things need attention, the biggest group is ${top.label.toLowerCase()} (${top.count.toLocaleString("en-US")})`;
}

// ---------- the per-account bars ----------

export type AccountBar = { locationId: string; name: string; count: number; dollars: number | null; kinds: Kind[]; /** How many of each kind, for the coloured segments of the bar. */ byKind: Partial<Record<Kind, number>> };

/** "Where it is happening": the accounts with the most things to fix, top `max`. The bar is the number of things; the dollars are in the tooltip. */
export function accountBars(rows: QueueRow[], max = 8): { bars: AccountBar[]; accounts: number } {
  const by = new Map<string, AccountBar>();
  for (const r of rows) {
    const cur = by.get(r.locationId) ?? { locationId: r.locationId, name: r.accountName, count: 0, dollars: null, kinds: [], byKind: {} };
    cur.count += r.count;
    if (r.dollars) cur.dollars = (cur.dollars ?? 0) + r.dollars;
    if (!cur.kinds.includes(r.kind)) cur.kinds.push(r.kind);
    cur.byKind[r.kind] = (cur.byKind[r.kind] ?? 0) + r.count;
    by.set(r.locationId, cur);
  }
  const all = [...by.values()].sort((a, b) => b.count - a.count || (b.dollars ?? 0) - (a.dollars ?? 0) || a.name.localeCompare(b.name));
  return { bars: all.slice(0, max), accounts: all.length };
}

export function barsTitle(b: { bars: AccountBar[]; accounts: number }): string {
  if (b.bars.length === 0) return "No client has anything to do";
  const top = b.bars[0];
  return b.accounts === 1 ? `${top.name} has ${plural(top.count, "thing")} to do` : `${top.name} has the most to do: ${top.count}.`;
}

/** The tooltip, in words: "Bright Smile Dental: 14 leads waiting, $6,300 at stake". */
export function barTooltip(b: AccountBar, rows: QueueRow[]): string {
  const mine = rows.filter((r) => r.locationId === b.locationId);
  const parts = KINDS.map((k) => mine.filter((r) => r.kind === k)).filter((x) => x.length > 0)
    .map((x) => { const w = COUNT_WORDS[x[0].kind]; const n = x.reduce((s, r) => s + r.count, 0); return `${n.toLocaleString("en-US")} ${n === 1 ? w[0] : w[1]}`; });
  return `${b.name}: ${parts.join(", ")}${b.dollars ? `, ${money(b.dollars)} in quiet deals` : ""}`;
}

// ---------- accounts needing you ----------

export type NeedingYou = {
  locationId: string; name: string; state: "Needs you now" | "Needs a look" | "Slipping"; reason: string; count: number; dollars: number | null; url: string;
  /** The account's biggest problem (the row Done, Snooze and Assign act on), and how many kinds of problem the account has. */
  top: QueueRow; kinds: number; oldestMinutes: number | null; urgent: boolean; /** The account's worst severity over all its rows (the row's stripe and word). */ severity: Severity;
};

/** One row per account, the worst reason first, ranked by the same rule as the queue. */
export function accountsNeedingYou(rows: QueueRow[], accounts: Map<string, AccountFacts>, limit = 5): { rows: NeedingYou[]; total: number } {
  const seen = new Set<string>();
  const out: NeedingYou[] = [];
  for (const r of rankQueue(rows)) {
    if (seen.has(r.locationId)) continue;
    seen.add(r.locationId);
    const mine = rows.filter((x) => x.locationId === r.locationId);
    // The stripe and the word describe the problem the row names (its biggest one), so a row about 2 quiet deals is not drawn red because another kind of problem is old.
    const worst = r.severity;
    const dollars = mine.reduce((s, x) => s + (x.dollars ?? 0), 0);
    out.push({
      locationId: r.locationId, name: r.accountName, state: worst === "critical" ? "Needs you now" : worst === "warning" ? "Needs a look" : "Slipping",
      reason: r.text, count: mine.reduce((s, x) => s + x.count, 0), dollars: dollars > 0 ? dollars : null, url: accounts.get(r.locationId)?.url ?? r.url,
      top: r, kinds: mine.length, oldestMinutes: mine.reduce<number | null>((m, x) => (x.since === null ? m : Math.max(m ?? 0, x.ageMinutes)), null), urgent: worst === "critical", severity: worst,
    });
  }
  return { rows: out.slice(0, limit), total: out.length };
}

// ---------- one person on the Reply now list ----------

/** How long it has been wrong, in the words of its kind: "Waiting 3 h", "Quiet for 65 days". */
export const ageLabel = (kind: Kind, age: string) => (kind === "replies" ? `Waiting ${age}` : kind === "stale" ? `Quiet for ${age}` : `Open for ${age}`);

/** The one line under a person's name: where they came from, or the channel of their last message. No wait time here (the wait has its own column). */
export function replyContext(i: Pick<TodayItem, "newLead" | "source" | "detail">): string {
  if (i.newLead) return i.source ? `New lead from ${i.source}` : "New lead";
  const channel = i.detail.split(", waiting")[0]?.trim();
  return channel ? `${channel}. The customer wrote last.` : "The customer wrote last.";
}
/** The part of a waiting person's item id after the account: what a one-person row key carries. */
export const personOf = (i: Pick<TodayItem, "id" | "locationId">) => i.id.slice(`replies:${i.locationId}:`.length);
/** A waiting person as a one-row group, so Done, Snooze and Assign work on one person exactly as they do on a whole row. */
export function personRow(i: TodayItem, now: number): QueueRow {
  const ageMinutes = i.at === null ? 0 : Math.max(0, Math.round((now - i.at) / 60_000));
  return {
    key: `${i.locationId}|replies|${personOf(i)}`, kind: "replies", locationId: i.locationId, accountName: i.accountName, text: `${i.name} is waiting for a reply`, count: 1, dollars: null, estimate: null,
    since: i.at, ageMinutes, severity: ageMinutes >= URGENT_WAIT_MINUTES ? "critical" : "warning", url: i.url, itemIds: [i.id], partial: false,
  };
}
/** The people waiting, longest wait first (a person with no known start goes last). */
export const waitingOldestFirst = (items: TodayItem[]): TodayItem[] => items.filter((i) => i.kind === "replies").sort((a, b) => (a.at ?? Infinity) - (b.at ?? Infinity) || a.name.localeCompare(b.name));

// ---------- vs your usual ----------

export type Verdict = "better" | "worse" | "same" | "not_enough";
export type Usual = { verdict: Verdict; text: string };

/** Compared with its own earlier period, only when both sides have at least `minN` observations; a difference under `tolerance` is "about the same". */
export function vsUsual(i: { now: number | null; usual: number | null; nNow: number; nUsual: number; minN: number; lowerIsBetter: boolean; tolerance?: number; fmt: (n: number) => string }): Usual {
  if (i.now === null || i.usual === null || i.nNow < i.minN || i.nUsual < i.minN) return { verdict: "not_enough", text: "Not enough history yet to compare with your usual." };
  const tol = i.tolerance ?? 0.15;
  const change = i.usual === 0 ? (i.now === 0 ? 0 : 1) : (i.now - i.usual) / i.usual;
  if (Math.abs(change) < tol) return { verdict: "same", text: `About the same as usual (${i.fmt(i.usual)}).` };
  const better = i.lowerIsBetter ? change < 0 : change > 0;
  return { verdict: better ? "better" : "worse", text: `${better ? "Better" : "Worse"} than usual (${i.fmt(i.usual)}).` };
}

export type ReplyRow = { leadAt: number; touchAt: number | null };
export type ReplyPoint = { day: string; value: number; /** "Leads that arrived 8 to 14 Nov". */ window: string };
const DAY = 86_400_000;
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.max(0, Math.ceil(0.5 * s.length) - 1))]; };
const dayKey = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const dayWords = (ms: number) => new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

/** The typical (median) first reply of the leads that arrived in (to - days, to] and have been answered; null under the minimum for a median (speed-intel MIN_FOR_MEDIAN). */
export function medianReply(rows: ReplyRow[], to: number, days: number): { seconds: number | null; answered: number } {
  const times = rows.filter((r) => r.touchAt !== null && r.leadAt > to - days * DAY && r.leadAt <= to).map((r) => Math.max(0, Math.round(((r.touchAt as number) - r.leadAt) / 1000)));
  return { seconds: times.length >= MIN_FOR_MEDIAN ? median(times) : null, answered: times.length };
}

/**
 * Reply speed against the account's own usual: the typical first reply of the last 7 days against the 7 days before. The line is the 7-day typical reply for
 * each of the last 7 days (a day with fewer than the minimum answered leads is left out, never guessed).
 */
export function replyPulse(rows: ReplyRow[], now: number): { current: { seconds: number | null; answered: number }; usual: { seconds: number | null; answered: number }; points: ReplyPoint[]; verdict: Usual } {
  const current = medianReply(rows, now, 7);
  const usual = medianReply(rows, now - 7 * DAY, 7);
  const points: ReplyPoint[] = [];
  for (let back = 6; back >= 0; back--) {
    const end = now - back * DAY;
    const m = medianReply(rows, end, 7);
    if (m.seconds !== null) points.push({ day: dayKey(end), value: m.seconds, window: `Leads that arrived ${dayWords(end - 7 * DAY)} to ${dayWords(end)}` });
  }
  const verdict = vsUsual({ now: current.seconds, usual: usual.seconds, nNow: current.answered, nUsual: usual.answered, minN: MIN_FOR_MEDIAN, lowerIsBetter: true, fmt: replyWords });
  return { current, usual, points, verdict };
}

/** A reply time in words: "45 sec", "5 min", "2 h 10 min". */
export function replyWords(seconds: number | null): string {
  if (seconds === null) return "not enough replies yet";
  if (seconds < 60) return `${seconds} sec`;
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 === 0 ? `${h} h` : `${h} h ${m % 60} min`;
  const d = Math.floor(h / 24);
  return `${d} ${d === 1 ? "day" : "days"}`;
}

export type WithinRow = { leadAt: number; touchAt: number | null; /** The account's own reply target, when it set one. */ targetMinutes?: number | null };
const tgtOf = (r: WithinRow, d: number) => (typeof r.targetMinutes === "number" && r.targetMinutes > 0 ? r.targetMinutes : d) * 60_000;
/**
 * Days in a row, counting back from yesterday, on which at least one lead arrived and every lead that arrived was answered inside the target.
 * A day with no leads neither extends nor breaks the run. Only existing data (the lead's own arrival and first reply) is used.
 */
export function answeredStreak(rows: WithinRow[], targetMinutes: number, now: number, days = 14): number {
  const byDay = new Map<string, WithinRow[]>();
  for (const r of rows) byDay.set(dayKey(r.leadAt), [...(byDay.get(dayKey(r.leadAt)) ?? []), r]);
  let streak = 0;
  for (let back = 1; back <= days; back++) {
    const list = byDay.get(dayKey(now - back * DAY));
    if (!list || list.length === 0) continue;
    const ok = list.every((r) => r.touchAt !== null && r.touchAt - r.leadAt <= tgtOf(r, targetMinutes));
    if (!ok) break;
    streak += 1;
  }
  return streak;
}

/** Share of leads that arrived in (to - days, to] answered inside the target, counting still-waiting ones past the target as misses; null under the minimum. */
export function withinTargetShare(rows: WithinRow[], targetMinutes: number, to: number, days: number): { share: number | null; judged: number } {
  const mine = rows.filter((r) => r.leadAt > to - days * DAY && r.leadAt <= to);
  const judged = mine.filter((r) => r.touchAt !== null || to - r.leadAt > tgtOf(r, targetMinutes));
  const within = judged.filter((r) => r.touchAt !== null && r.touchAt - r.leadAt <= tgtOf(r, targetMinutes)).length;
  return { share: judged.length >= MIN_FOR_MEDIAN ? within / judged.length : null, judged: judged.length };
}

// ---------- what SubSync caught ----------

export type AlertFact = { id: string; locationId: string | null; accountName: string; title: string; severity: Severity; createdAt: number; resolvedAt: number | null };
export type ProofDay = { day: string; label: string; raised: AlertFact[]; cleared: AlertFact[] };
export type Proof = { raised: number; cleared: number; open: number; days: ProofDay[]; /** The alerts still open now (the list behind "Still open"). */ openAlerts: AlertFact[] };

/** Alerts over the last 7 days: raised that day, cleared that day (we only know the condition went away, not whether a person fixed it), and how many are still open now. */
export function proofOf(alerts: AlertFact[], now: number): Proof {
  const days: ProofDay[] = [];
  for (let back = 6; back >= 0; back--) {
    const d = now - back * DAY;
    days.push({ day: dayKey(d), label: new Date(d).toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" }), raised: [], cleared: [] });
  }
  const at = new Map(days.map((d) => [d.day, d]));
  for (const a of alerts) {
    at.get(dayKey(a.createdAt))?.raised.push(a);
    if (a.resolvedAt !== null) at.get(dayKey(a.resolvedAt))?.cleared.push(a);
  }
  return { raised: days.reduce((s, d) => s + d.raised.length, 0), cleared: days.reduce((s, d) => s + d.cleared.length, 0), open: alerts.filter((a) => a.resolvedAt === null).length, days, openAlerts: alerts.filter((a) => a.resolvedAt === null) };
}

export function proofLine(p: Proof): string {
  return `Last 7 days: ${plural(p.raised, "alert")} raised, ${p.cleared} cleared, ${p.open} still open.`;
}
export const PROOF_NOTE = "Cleared means the problem is gone from your CRM data. SubSync cannot tell whether a person fixed it or it went away on its own.";

// ---------- stale deals against the account's own normal ----------

/** The stale-deal count against its own recent normal, using the daily check's own rule (`compare` in digest-intel.ts: at least 4 earlier days, outside the usual band). */
export function staleUsual(s: { today: number; usual: number | null; samples: number; unusual: "up" | "down" | null } | null): Usual {
  if (!s || s.usual === null || s.samples < 4) return { verdict: "not_enough", text: "Not enough history yet to compare with your usual." };
  const usual = Math.round(s.usual);
  if (s.unusual === "up") return { verdict: "worse", text: `More quiet deals than usual (about ${usual}).` };
  if (s.unusual === "down") return { verdict: "better", text: `Fewer quiet deals than usual (about ${usual}).` };
  return { verdict: "same", text: `About the same as usual (about ${usual}).` };
}

// ---------- share ----------

/**
 * The daily brief (Slack and email) says what Today says, in the same order: the same headline, the same breakdown, then the top rows of the Fix first queue, then
 * how many things are set aside. It is built from the same queue, so the brief and the screen cannot disagree. Returns plain lines; the sender decides the format.
 */
export function briefLines(i: { headline: Headline; rows: QueueRow[]; setAside: number; limit?: number }): string[] {
  const lines = [i.headline.text];
  if (i.headline.breakdown) lines.push(i.headline.breakdown);
  if (i.headline.note) lines.push(i.headline.note);
  const top = i.rows.slice(0, i.limit ?? 5);
  if (top.length > 0) {
    lines.push("Do this first:");
    top.forEach((r, n) => lines.push(`${n + 1}. ${r.accountName}: ${r.text}${r.dollars ? `, ${money(r.dollars)} in deals` : r.estimate ? `, about ${money(r.estimate)}, estimated` : ""}${r.since !== null ? `, open for ${ageWords(r.ageMinutes)}` : ""}`));
    if (i.rows.length > top.length) lines.push(`${i.rows.length - top.length} more are in SubSync.`);
  }
  if (i.setAside > 0) lines.push(`${i.setAside} ${i.setAside === 1 ? "item is" : "items are"} snoozed or marked done and not counted above.`);
  return lines;
}

/** Plain text for Slack or email: the headline and the top three things. SubSync sends nothing; the person pastes it. */
export function shareText(i: { who: string; headline: Headline; rows: QueueRow[] }): string {
  const lines = [`${i.who}: Today`, i.headline.text];
  if (i.headline.breakdown) lines.push(i.headline.breakdown);
  if (i.headline.note) lines.push(i.headline.note);
  const top = i.rows.slice(0, 3);
  if (top.length > 0) {
    lines.push("", "Do this first:");
    top.forEach((r, n) => lines.push(`${n + 1}. ${r.accountName}: ${r.text}${r.dollars ? `, ${money(r.dollars)} in deals` : ""}${r.since !== null ? `, open for ${ageWords(r.ageMinutes)}` : ""}`));
  }
  return lines.join("\n");
}
