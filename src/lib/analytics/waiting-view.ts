// The Unanswered messages page, as pure rules (stage F4). No database, no network, no React: the page, the chart behind it and the tests all read this.
//
// What this file does NOT decide: which conversations are waiting. That is waiting.ts (and the SQL in queries.ts that a database test checks against it):
// the customer wrote last, the reply target has passed, inside the 30 day window. Here the waiting rows are only sorted, filtered, split into the
// three tabs and counted, and the counts are taken from the very rows that are listed, so a number can never differ from its list.
import { AGING_DEFS } from "./comms-intel.ts";

/** A waiting conversation of seven days or more is "Older". Same edge as the "Older than a week" bucket of the wait chart. */
export const RECENT_HOURS = 7 * 24;

export type QueueRow = {
  conversationId: string; locationId: string; locationName: string | null;
  contactId: string | null; contactName: string | null;
  /** The channel in words ("WhatsApp", "Text message"). */
  channel: string; lastMessageType: string | null; lastMessageDirection: string | null; lastMessageAt: string | null;
  unreadCount: number; overSla: boolean;
  /** Whole hours since the customer wrote, only when the customer wrote last. */
  waitingHours: number | null;
  /** Whole hours since the last message of any kind. */
  ageHours: number | null;
  /** The team member the contact is assigned to (an id, used only as a filter key; people read `assignee`). Null: nobody. */
  assignedTo: string | null;
  /** The name a person reads: a name, "No owner", or the plain note that the name is not available. */
  assignee: string;
  /** Opens this conversation in the CRM, built with the white-label link helper on the server. */
  url: string;
};

// ---------------- tabs ----------------

export type TabId = "recent" | "older" | "unread";
export const TABS: ReadonlyArray<{ id: TabId; label: string }> = [
  { id: "recent", label: "Last 7 days" },
  { id: "older", label: "Older" },
  { id: "unread", label: "Unread" },
];
export const isTab = (v: unknown): v is TabId => v === "recent" || v === "older" || v === "unread";
export const isWaitingTab = (t: TabId) => t !== "unread";

/** Which tab a row belongs to. A conversation can be in two: waiting and unread. */
export function inTab(r: QueueRow, tab: TabId): boolean {
  if (tab === "unread") return r.unreadCount > 0;
  if (!r.overSla || r.waitingHours === null) return false;
  return tab === "recent" ? r.waitingHours < RECENT_HOURS : r.waitingHours >= RECENT_HOURS;
}
const inAnyTab = (r: QueueRow) => inTab(r, "recent") || inTab(r, "older") || inTab(r, "unread");

// ---------------- the filter ----------------

export type WaitKey = "any" | "4h" | "24h" | "48h" | "7d";
/** "Over" is "this long or more": a conversation that has waited 4 hours and 30 minutes is over 4 hours. */
export const WAIT_CHIPS: ReadonlyArray<{ key: WaitKey; label: string; hours: number }> = [
  { key: "any", label: "Any wait", hours: 0 },
  { key: "4h", label: "Over 4 hours", hours: 4 },
  { key: "24h", label: "Over 24 hours", hours: 24 },
  { key: "48h", label: "Over 48 hours", hours: 48 },
  { key: "7d", label: "Over 7 days (older)", hours: RECENT_HOURS },
];
const isWait = (v: unknown): v is WaitKey => WAIT_CHIPS.some((c) => c.key === v);

export type SortKey = "longest" | "newest";
export const SORTS: ReadonlyArray<{ key: SortKey; label: string }> = [{ key: "longest", label: "Longest wait first" }, { key: "newest", label: "Newest first" }];

export type QueueFilter = {
  tab: TabId; wait: WaitKey;
  /** A channel in words, or "" for every channel. */
  channel: string;
  /** A client account id, or "" for every account. */
  account: string;
  /** "" anyone, "me" assigned to the person looking, "none" no owner, or a team member id. */
  user: string;
  sort: SortKey;
};
export const DEFAULT_QUEUE: QueueFilter = { tab: "recent", wait: "any", channel: "", account: "", user: "", sort: "longest" };

const CHANNEL_OK = /^[A-Za-z0-9 .&'-]{1,40}$/;
const ID_OK = /^[A-Za-z0-9_-]{1,64}$/;

/** Anything in, a valid filter out. Used for the address, for a saved view and for the server's check of one, so a damaged value falls back to the default. */
export function sanitizeQueue(v: unknown): QueueFilter {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const str = (x: unknown) => (typeof x === "string" ? x : "");
  const user = str(o.user);
  return {
    tab: isTab(o.tab) ? o.tab : DEFAULT_QUEUE.tab,
    wait: isWait(o.wait) ? o.wait : DEFAULT_QUEUE.wait,
    channel: CHANNEL_OK.test(str(o.channel)) ? str(o.channel) : "",
    account: /^[A-Za-z0-9_-]{3,64}$/.test(str(o.account)) ? str(o.account) : "",
    user: user === "me" || user === "none" || ID_OK.test(user) ? user : "",
    sort: o.sort === "newest" ? "newest" : "longest",
  };
}
export const isDefaultQueue = (f: QueueFilter) => JSON.stringify(sanitizeQueue(f)) === JSON.stringify(DEFAULT_QUEUE);
/** Whether anything narrows the rows (the tab and the sort do not narrow). */
export const narrows = (f: QueueFilter) => f.wait !== "any" || f.channel !== "" || f.account !== "" || f.user !== "";

// ---------------- in the address ----------------
// Carried after the # as q.tab, q.wait, q.ch, q.acct, q.who, q.sort, next to whatever else the address holds (the page's filter, a card's range).
const KEYS = { tab: "q.tab", wait: "q.wait", channel: "q.ch", account: "q.acct", user: "q.who", sort: "q.sort" } as const;

export function queueIntoHash(hash: string, f: QueueFilter): string {
  const q = hash.indexOf("?");
  const head = q === -1 ? hash : hash.slice(0, q);
  const p = new URLSearchParams(q === -1 ? "" : hash.slice(q + 1));
  for (const k of Object.values(KEYS)) p.delete(k);
  const s = sanitizeQueue(f);
  if (s.tab !== DEFAULT_QUEUE.tab) p.set(KEYS.tab, s.tab);
  if (s.wait !== DEFAULT_QUEUE.wait) p.set(KEYS.wait, s.wait);
  if (s.channel) p.set(KEYS.channel, s.channel);
  if (s.account) p.set(KEYS.account, s.account);
  if (s.user) p.set(KEYS.user, s.user);
  if (s.sort !== DEFAULT_QUEUE.sort) p.set(KEYS.sort, s.sort);
  const rest = p.toString().replace(/%2C/g, ",").replace(/%3A/g, ":");
  return rest ? `${head}?${rest}` : head;
}

/** The queue part of an address, or null when it holds none (so a remembered choice can apply instead). */
export function queueFromHash(hash: string): QueueFilter | null {
  const q = hash.indexOf("?");
  if (q === -1) return null;
  const p = new URLSearchParams(hash.slice(q + 1));
  if (!Object.values(KEYS).some((k) => p.has(k))) return null;
  return sanitizeQueue({ tab: p.get(KEYS.tab), wait: p.get(KEYS.wait), channel: p.get(KEYS.channel), account: p.get(KEYS.account), user: p.get(KEYS.user), sort: p.get(KEYS.sort) });
}

// ---------------- who it is assigned to (N21: names, never ids) ----------------

export const NO_OWNER = "No owner";
export const NAME_MISSING = "Team member (name not available)";

/** The words for who a contact is assigned to. A missing name is said plainly, never shown as an id. */
export function assigneeLabel(userId: string | null | undefined, names: ReadonlyMap<string, string>): string {
  if (!userId) return NO_OWNER;
  const n = names.get(userId)?.trim();
  return n ? n : NAME_MISSING;
}

export type Choice = { key: string; label: string; count: number };

const countBy = (rows: QueueRow[], key: (r: QueueRow) => string | null) => {
  const m = new Map<string, number>();
  for (const r of rows) { const k = key(r); if (k) m.set(k, (m.get(k) ?? 0) + 1); }
  return m;
};

/** The people to choose between: "Assigned to me" when the person looking has rows, "No owner", then each team member, most first. Same-looking unnamed people are numbered. */
export function userChoices(rows: QueueRow[], me: string | null): Choice[] {
  const seen = rows.filter(inAnyTab);
  const out: Choice[] = [];
  if (me) { const n = seen.filter((r) => r.assignedTo === me).length; if (n > 0) out.push({ key: "me", label: "Assigned to me", count: n }); }
  const none = seen.filter((r) => !r.assignedTo).length;
  if (none > 0) out.push({ key: "none", label: NO_OWNER, count: none });
  const by = countBy(seen, (r) => r.assignedTo);
  const named: Choice[] = []; const unnamed: Choice[] = [];
  const labelOf = new Map(seen.filter((r) => r.assignedTo).map((r) => [r.assignedTo as string, r.assignee]));
  for (const [id, count] of by) if (id !== me) (labelOf.get(id) === NAME_MISSING ? unnamed : named).push({ key: id, label: labelOf.get(id) ?? NAME_MISSING, count });
  named.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  unnamed.sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
  unnamed.forEach((c, i) => { if (unnamed.length > 1) c.label = NAME_MISSING.replace("Team member", `Team member ${i + 1}`); });
  return [...out, ...named, ...unnamed];
}

export function accountChoices(rows: QueueRow[]): Choice[] {
  const seen = rows.filter(inAnyTab);
  const names = new Map(seen.map((r) => [r.locationId, r.locationName ?? "Unnamed account"]));
  return [...countBy(seen, (r) => r.locationId)].map(([key, count]) => ({ key, label: names.get(key) ?? "Unnamed account", count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

export function channelChoices(rows: QueueRow[]): Choice[] {
  const seen = rows.filter(inAnyTab);
  return [...countBy(seen, (r) => r.channel)].map(([key, count]) => ({ key, label: key, count })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/**
 * A choice that no longer matches anything (a remembered account that was removed, a person with nothing left in the queue) must not hide every row
 * without saying so: it is dropped, and the page shows what is really there.
 */
export function reconcile(f: QueueFilter, rows: QueueRow[], me: string | null): QueueFilter {
  const seen = rows.filter(inAnyTab);
  const user = f.user === "" ? ""
    : f.user === "me" ? (me !== null && seen.some((r) => r.assignedTo === me) ? "me" : "")
    : f.user === "none" ? (seen.some((r) => !r.assignedTo) ? "none" : "")
    : seen.some((r) => r.assignedTo === f.user) ? f.user : "";
  return {
    ...f,
    channel: f.channel && seen.some((r) => r.channel === f.channel) ? f.channel : "",
    account: f.account && seen.some((r) => r.locationId === f.account) ? f.account : "",
    user,
  };
}

// ---------------- filtering, counting, sorting ----------------

/** The rows left after the channel, account and person choices. The tab and the wait chip are applied on top of this. */
export function scoped(rows: QueueRow[], f: QueueFilter, me: string | null): QueueRow[] {
  return rows.filter((r) =>
    (!f.channel || r.channel === f.channel)
    && (!f.account || r.locationId === f.account)
    && (f.user === "" || (f.user === "none" ? !r.assignedTo : f.user === "me" ? me !== null && r.assignedTo === me : r.assignedTo === f.user)));
}

const chipHours = (w: WaitKey) => WAIT_CHIPS.find((c) => c.key === w)?.hours ?? 0;
const waitedAtLeast = (r: QueueRow, hours: number) => (r.waitingHours ?? -1) >= hours;

/** The rows of one tab under the current choices. The wait chip applies to the two waiting tabs only: an unread conversation that nobody is waiting on has no wait to measure. */
export function tabRows(rows: QueueRow[], f: QueueFilter, me: string | null, tab: TabId = f.tab): QueueRow[] {
  const base = scoped(rows, f, me).filter((r) => inTab(r, tab));
  return isWaitingTab(tab) && f.wait !== "any" ? base.filter((r) => waitedAtLeast(r, chipHours(f.wait))) : base;
}

/** The three tab counts. Each is `tabRows(...).length`, so a count is always the number of rows in its list. */
export function tabCounts(rows: QueueRow[], f: QueueFilter, me: string | null): Record<TabId, number> {
  return { recent: tabRows(rows, f, me, "recent").length, older: tabRows(rows, f, me, "older").length, unread: tabRows(rows, f, me, "unread").length };
}

/** How many waiting conversations each wait chip would leave, after the other choices. "Any wait" is the whole waiting set. */
export function chipCounts(rows: QueueRow[], f: QueueFilter, me: string | null): Record<WaitKey, number> {
  const waiting = scoped(rows, f, me).filter((r) => inTab(r, "recent") || inTab(r, "older"));
  const out = {} as Record<WaitKey, number>;
  for (const c of WAIT_CHIPS) out[c.key] = waiting.filter((r) => waitedAtLeast(r, c.hours)).length;
  return out;
}

/** The longest wait first (the unread tab: the oldest message first), or the newest first. Same order on every run: ties are broken by the conversation. */
export function sortQueue(rows: QueueRow[], sort: SortKey, tab: TabId): QueueRow[] {
  const key = (r: QueueRow) => (isWaitingTab(tab) ? r.waitingHours : r.ageHours) ?? -1;
  const dir = sort === "newest" ? -1 : 1;
  return [...rows].sort((a, b) => dir * (key(b) - key(a)) || a.conversationId.localeCompare(b.conversationId));
}

/** What the page lists for the open tab: the rows, in order. */
export function listFor(rows: QueueRow[], f: QueueFilter, me: string | null): QueueRow[] {
  return sortQueue(tabRows(rows, f, me), f.sort, f.tab);
}

/** The first few rows of a tab, in the order that matters for that tab (the longest wait first), for the peek under the open tab. */
export function peekFor(rows: QueueRow[], f: QueueFilter, me: string | null, tab: TabId, n = 3): QueueRow[] {
  return sortQueue(tabRows(rows, f, me, tab), "longest", tab).slice(0, n);
}

// ---------------- the charts, with the rows behind every mark ----------------

export type Group = { label: string; count: number; rows: QueueRow[] };

/** The waiting conversations after the channel, account and person choices (every tab and chip left out): what the charts show. */
export function waitingSet(rows: QueueRow[], f: QueueFilter, me: string | null): QueueRow[] {
  return scoped(rows, f, me).filter((r) => inTab(r, "recent") || inTab(r, "older"));
}

/** The wait chart: how long the waiting customers have waited. Each bucket carries its own rows, so its count is its list. */
export function agingGroups(waiting: QueueRow[]): Group[] {
  return AGING_DEFS.map((d) => {
    const rs = sortQueue(waiting.filter((r) => r.waitingHours !== null && r.waitingHours >= d.min && r.waitingHours < d.max), "longest", "recent");
    return { label: d.label, count: rs.length, rows: rs };
  });
}

/** Waiting conversations by client account, most first. Past `top` accounts the rest are one "Other accounts" group. */
export function accountGroups(waiting: QueueRow[], top = 8): Group[] {
  const by = new Map<string, QueueRow[]>();
  for (const r of waiting) by.set(r.locationId, [...(by.get(r.locationId) ?? []), r]);
  const all = [...by.entries()].map(([id, rs]) => ({ label: rs[0].locationName ?? "Unnamed account", id, rows: sortQueue(rs, "longest", "recent") }))
    .sort((a, b) => b.rows.length - a.rows.length || a.label.localeCompare(b.label));
  const shown = all.slice(0, top).map((g) => ({ label: g.label, count: g.rows.length, rows: g.rows }));
  const rest = all.slice(top);
  if (rest.length > 0) {
    const rows = sortQueue(rest.flatMap((g) => g.rows), "longest", "recent");
    shown.push({ label: `Other accounts (${rest.length})`, count: rows.length, rows });
  }
  return shown;
}

// ---------------- words ----------------

/** "Customer wrote via WhatsApp 5 hours ago", for the lead panel. */
export function lastLine(r: QueueRow, ago: string): string {
  const who = r.lastMessageDirection === "inbound" ? "Customer wrote" : r.lastMessageDirection === "outbound" ? "You replied" : "Last activity";
  return `${who} via ${r.channel.toLowerCase()} ${ago}.`;
}

/** One line of plain text per row, for the Copy list button. */
export function rowText(r: QueueRow, waitText: string): string {
  return [r.contactName ?? "Unknown contact", r.locationName ?? "Unnamed account", r.channel, r.overSla ? `waiting ${waitText}` : r.unreadCount > 0 ? `${r.unreadCount} unread` : "", r.assignee].filter(Boolean).join(", ");
}

/** A call is the last thing the customer did, but the sync does not keep whether it was answered. The row says so instead of guessing. */
export const CALL_NOTE = "A call. SubSync cannot tell whether it was answered, so check it in your CRM.";
export const isCallChannel = (r: QueueRow) => r.channel === "Call";

/** A saved view's name: trimmed, one line, up to 40 characters. Null when nothing usable is left. */
export function viewName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.replace(/\s+/g, " ").trim();
  return t.length >= 1 && t.length <= 40 ? t : null;
}
export const MAX_SAVED_VIEWS = 10;
