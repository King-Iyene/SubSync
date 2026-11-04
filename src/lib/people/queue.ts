// The ready-made call lists of People and the rules around them (stage PEOPLE). Pure, so they are unit tested. These lists are NOT new definitions: each one is
// the list another page already uses, read through the same function (docs/METRICS.md, "People, call lists"):
//   waiting   Speed to lead's "waiting for a reply" (Today's new leads),
//   noshows   Appointments' "no-shows to rebook" (the last 14 days, not booked again),
//   followups the follow-ups a person set when logging a call (the existing call list),
//   hot       the existing call list "hot leads not contacted in 3+ days",
//   stale     Today's "deals gone quiet" (counted deals, no movement for the account's stale days).
// The database side is src/lib/analytics/people-queue-queries.ts.

export const LIST_IDS = ["waiting", "noshows", "followups", "hot", "stale"] as const;
export type ListId = (typeof LIST_IDS)[number];
export const isListId = (v: unknown): v is ListId => typeof v === "string" && (LIST_IDS as readonly string[]).includes(v);

export const QUEUE_PAGE = 25;
export const HOT_IDLE_DAYS = 3;

export type ListInfo = { id: ListId; label: string; short: string; /** The word on the tab: short enough for five tabs to fit on a phone. */ chip: string; help: string; same: string };

/** `staleDays` is the account setting the stale list uses (Today and Account audit use the same one). */
export function listInfo(id: ListId, staleDays: number): ListInfo {
  switch (id) {
    case "waiting": return { id, label: "Waiting for a reply", short: "Waiting", chip: "Waiting", help: "New leads nobody has replied to, the longest wait first.", same: "The same people as Speed to lead and Today." };
    case "noshows": return { id, label: "No-shows to rebook", short: "No-shows", chip: "No-shows", help: "Missed an appointment in the last 14 days and have not booked again.", same: "The same people as Appointments." };
    case "followups": return { id, label: "Follow-ups due", short: "Follow-ups", chip: "Follow-ups", help: "People you marked for a follow-up when you logged a call, whose day has come.", same: "Set by the calls logged in SubSync." };
    case "hot": return { id, label: "Hot leads gone quiet", short: "Hot leads", chip: "Hot", help: `An open deal and nothing for ${HOT_IDLE_DAYS} days or more, the biggest deals first.`, same: "The \"hot leads\" call list." };
    case "stale": return { id, label: "Stale deals", short: "Stale deals", chip: "Stale", help: `Open deals with no movement for ${staleDays} days or more, the biggest first.`, same: "The same deals as Today and the Account audit." };
  }
}

export type ListCount = { id: ListId; total: number; mine: number | null };

/** The list to open first: the first one with anybody on it, in the order above (a waiting customer beats a stale deal). Null when every list is empty. */
export function startHere(counts: ReadonlyArray<Pick<ListCount, "id" | "total">>): ListId | null {
  for (const id of LIST_IDS) if ((counts.find((c) => c.id === id)?.total ?? 0) > 0) return id;
  return null;
}

/**
 * Whether the list opens on "Mine" (the people assigned to the person asking). A client's own staff (the setters) start on their own queue, but only when
 * something is assigned to them: a queue of zero would look broken, so with nothing assigned they see everyone and the screen says so. Anyone else starts on everyone.
 */
export function startOnMine(i: { staff: boolean; mine: number | null }): boolean {
  return i.staff && (i.mine ?? 0) > 0;
}

export type Say = { text: string; allClear: boolean };

const THING: Record<ListId, (n: number, staleDays: number) => string> = {
  waiting: (n) => `${n.toLocaleString("en-US")} ${n === 1 ? "new lead is" : "new leads are"} waiting for a reply`,
  noshows: (n) => `${n.toLocaleString("en-US")} ${n === 1 ? "person" : "people"} missed an appointment and could be rebooked`,
  followups: (n) => `${n.toLocaleString("en-US")} ${n === 1 ? "follow-up is" : "follow-ups are"} due`,
  hot: (n) => `${n.toLocaleString("en-US")} hot ${n === 1 ? "lead has" : "leads have"} gone quiet`,
  stale: (n, d) => `${n.toLocaleString("en-US")} ${n === 1 ? "deal has" : "deals have"} not moved for ${d} days or more`,
};

/** The one sentence at the top of People: the most urgent list that has anybody on it, and the rest in a short "Also". */
export function queueSay(counts: ReadonlyArray<Pick<ListCount, "id" | "total">>, staleDays: number): { head: string; also: string | null; allClear: boolean } {
  const first = startHere(counts);
  if (!first) return { head: "Nobody needs a call right now.", also: null, allClear: true };
  const n = counts.find((c) => c.id === first)?.total ?? 0;
  const ALSO: Record<ListId, [string, string]> = { waiting: ["waiting", "waiting"], noshows: ["no-show", "no-shows"], followups: ["follow-up", "follow-ups"], hot: ["hot lead", "hot leads"], stale: ["stale deal", "stale deals"] };
  const rest = LIST_IDS.filter((id) => id !== first && (counts.find((c) => c.id === id)?.total ?? 0) > 0).map((id) => {
    const t = counts.find((c) => c.id === id)?.total ?? 0;
    return `${t.toLocaleString("en-US")} ${ALSO[id][t === 1 ? 0 : 1]}`;
  });
  return { head: `${THING[first](n, staleDays)}.`, also: rest.length ? `Also: ${rest.join(", ")}.` : null, allClear: false };
}

/** What to suggest when every list is empty, so the page is never a dead end. */
export function allClearStep(multi: boolean): string {
  return multi ? "Search for someone above, or open Going cold to see who has gone quiet across your clients." : "Search for someone above, or open Going cold to see who has gone quiet.";
}

// ---------------- paging in memory (the lists that are cut from one short read) ----------------

export function pageOf<T>(list: readonly T[], page: number, size = QUEUE_PAGE): { rows: T[]; page: number; pages: number; total: number; from: number; to: number } {
  const total = list.length;
  const pages = Math.max(1, Math.ceil(total / size));
  const p = Math.min(Math.max(1, Math.floor(page) || 1), pages);
  const start = (p - 1) * size;
  const rows = list.slice(start, start + size);
  return { rows, page: p, pages, total, from: total === 0 ? 0 : start + 1, to: start + rows.length };
}

// ---------------- the search box ----------------

export const SEARCH_MAX = 100;

export type SearchTerm = { ok: true; q: string; kind: "phone" | "email" | "name" } | { ok: false; reason: "short" | "empty" };

/** A name or email needs two characters; a phone number needs three digits (so "55" does not match every number). Spaces are squeezed, length capped. */
export function searchTerm(raw: string): SearchTerm {
  const q = raw.replace(/\s+/g, " ").trim().slice(0, SEARCH_MAX);
  if (!q) return { ok: false, reason: "empty" };
  const digits = q.replace(/\D/g, "");
  const phoneLike = /^[+(\d][\d\s().+-]*$/.test(q);
  if (phoneLike) return digits.length >= 3 ? { ok: true, q, kind: "phone" } : { ok: false, reason: "short" };
  if (q.length < 2) return { ok: false, reason: "short" };
  return { ok: true, q, kind: q.includes("@") ? "email" : "name" };
}

/** The most results the count is exact for: past it the screen says "10,000+" and the database stops counting (a search of two letters in a very big agency). */
export const COUNT_CAP = 10_000;
export const countWords = (total: number, capped: boolean): string => `${total.toLocaleString("en-US")}${capped ? "+" : ""}`;

// ---------------- recent searches and recently opened (kept on the server, per person) ----------------

export const MAX_RECENT_QUERIES = 8;
export const MAX_OPENED = 200;
export const SHOWN_OPENED = 8;

export type RecentStore = { q: string[]; opened: Array<{ k: string; at: string }> };
export const emptyRecent = (): RecentStore => ({ q: [], opened: [] });

/** Reads whatever was stored, keeping only well-formed entries (a damaged value never breaks the screen). */
export function cleanRecent(v: unknown): RecentStore {
  const o = (v && typeof v === "object" ? v : {}) as { q?: unknown; opened?: unknown };
  const q = Array.isArray(o.q) ? o.q.filter((x): x is string => typeof x === "string" && x.trim().length >= 2).map((x) => x.trim().slice(0, SEARCH_MAX)).slice(0, MAX_RECENT_QUERIES) : [];
  const opened = Array.isArray(o.opened)
    ? o.opened.filter((x): x is { k: string; at: string } => !!x && typeof (x as { k?: unknown }).k === "string" && typeof (x as { at?: unknown }).at === "string" && /^[A-Za-z0-9_-]{3,64}:[A-Za-z0-9_-]{3,128}$/.test((x as { k: string }).k) && Number.isFinite(Date.parse((x as { at: string }).at))).slice(0, MAX_OPENED)
    : [];
  return { q, opened };
}

/** A search the person ran goes to the front; the same words are not kept twice (ignoring case). */
export function pushQuery(r: RecentStore, raw: string): RecentStore {
  const t = searchTerm(raw);
  if (!t.ok) return r;
  const rest = r.q.filter((x) => x.toLowerCase() !== t.q.toLowerCase());
  return { ...r, q: [t.q, ...rest].slice(0, MAX_RECENT_QUERIES) };
}

export const personKey = (locationId: string, contactId: string) => `${locationId}:${contactId}`;

/** A person the signed-in person opened goes to the front with the time; opening the same one again only moves it. */
export function pushOpened(r: RecentStore, key: string, atIso: string): RecentStore {
  const rest = r.opened.filter((x) => x.k !== key);
  return { ...r, opened: [{ k: key, at: atIso }, ...rest].slice(0, MAX_OPENED) };
}

export const lastOpened = (r: RecentStore, key: string): string | null => r.opened.find((x) => x.k === key)?.at ?? null;
