import { decodeRange, encodeRange, type RangeSpec } from "./range.ts";

// The ONE global filter bar (KF-11): which pages draw it, what its date part means on each page, and how the page range lives in the address. Pure.

/** Pages whose numbers, charts and lists depend on a date range, with the client accounts picked in the bar. Every card on them follows the bar unless the card has its own labelled choice in the address. */
const RANGE_VIEWS = new Set(["speed", "appointments", "overview", "leads", "deals", "team", "pipeline", "accounts", "clients", "today", "myday", "payments", "meetings-list"]);
/** Pages that read their own client accounts (their own picker) but whose numbers still follow the date bar: the bar offers the dates only, so the two never disagree. */
const DATES_VIEWS = new Set(["workflows"]);
/** Meeting notes (a person's own inbox and set-up) takes no date or account choice from the bar, so it draws none. Once its Meetings list is on, the dashboard asks for "meetings-list", which does use the dates and the client choice. */
/** Pages that show what is true right now (a queue, a list of people, an audit of today's state): the bar says "Right now" instead of a range. */
const NOW_VIEWS = new Set(["inbox", "audit", "cleanup", "duplicates", "people", "search", "calls", "onboarding", "email"]);

export type BarMode = "range" | "now" | "none" | "dates";
export const barMode = (view: string): BarMode => (RANGE_VIEWS.has(view) ? "range" : DATES_VIEWS.has(view) ? "dates" : NOW_VIEWS.has(view) ? "now" : "none");

export const PAGE_RANGE_KEY = "page";
const PARAM = `r.${PAGE_RANGE_KEY}`;

export function pageRangeFromHash(hash: string): RangeSpec | null {
  const q = hash.indexOf("?");
  return q === -1 ? null : decodeRange(new URLSearchParams(hash.slice(q + 1)).get(PARAM));
}

/** The address with the page range set. Cards that had their own range in the address follow the bar again (their `r.*` pairs are dropped). Everything else is kept. */
export function withPageRange(hash: string, spec: RangeSpec | null): string {
  const q = hash.indexOf("?");
  const head = q === -1 ? hash : hash.slice(0, q);
  const p = new URLSearchParams(q === -1 ? "" : hash.slice(q + 1));
  for (const k of [...p.keys()]) if (k.startsWith("r.")) p.delete(k);
  if (spec) p.set(PARAM, encodeRange({ ...spec, compare: "none" }));
  const rest = p.toString().replace(/%2C/g, ",").replace(/%3A/g, ":").replace(/%7E/g, "~");
  return rest ? `${head}?${rest}` : head;
}

/** Recent clients first (in the order they were used), then the rest in their own order. */
export function recentFirst<T extends { id: string }>(accounts: T[], recent: string[]): T[] {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const top = recent.map((id) => byId.get(id)).filter((a): a is T => Boolean(a));
  const seen = new Set(top.map((a) => a.id));
  return [...top, ...accounts.filter((a) => !seen.has(a.id))];
}

/** The text on the account button. */
export function accountButtonText(picked: number, live: number): string {
  return picked === 0 || picked >= live ? `All ${live} client accounts` : `${picked} of ${live} client accounts`;
}
