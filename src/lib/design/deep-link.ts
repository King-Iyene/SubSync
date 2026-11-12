// A Today number opens exactly its rows: the button says which section, which date window and how many rows the number counted (pure, unit tested).
// The link is held in memory for one hop: the page it opens reads it once on arrival (takeDeepLink), so a later visit by the menu starts clean.
export type DeepLink = {
  view: "appointments" | "pipeline";
  /** The section to open first (Appointments: needs, recover. Pipeline: stale). */
  tab: string;
  /** Look-back window in days, wide enough to include every row the number counted. */
  days?: 7 | 30 | 90;
  /** One client account, when the number was for one. */
  location?: string | null;
  /** The count on the card. The page compares it with the rows it finds and says so when they differ. */
  expect?: number | null;
  /** What the card called it, for the one-line banner. */
  what?: string;
};

let pending: DeepLink | null = null;
export const setDeepLink = (l: DeepLink | null) => { pending = l; };
export const takeDeepLink = (view: DeepLink["view"]): DeepLink | null => { const l = pending && pending.view === view ? pending : null; if (l) pending = null; return l; };

/** The Today cards that link into another page, and the exact section, window and account that reproduces each count. */
export type CardKind = "unmarked" | "noshows" | "stale_deals";
/** How far back the Today count looks: unmarked appointments 90 days, no-shows 7 days. Must match the SQL in clients3-queries. */
export const UNMARKED_WINDOW_DAYS = 90;
export const NOSHOW_WINDOW_DAYS = 7;

export function cardLink(kind: CardKind, o: { count: number; location?: string | null }): DeepLink {
  const location = o.location || null;
  switch (kind) {
    case "unmarked": return { view: "appointments", tab: "needs", days: UNMARKED_WINDOW_DAYS, location, expect: o.count, what: "Appointments to confirm" };
    case "noshows": return { view: "appointments", tab: "recover", days: NOSHOW_WINDOW_DAYS, location, expect: o.count, what: "No-shows to rebook" };
    case "stale_deals": return { view: "pipeline", tab: "stale", location, expect: null, what: "Money at risk" };
  }
}

/** The one-line banner a page shows after a Today click. null = the rows match the card, nothing to say. */
export function arrivalNote(l: { expect?: number | null; what?: string }, rows: number | null): { tone: "empty" | "differs"; text: string } | null {
  if (rows === null || l.expect === null || l.expect === undefined) return null;
  if (rows === l.expect) return null;
  const what = l.what ?? "Today";
  if (rows === 0 && l.expect > 0) return { tone: "empty", text: `${what} counted ${l.expect.toLocaleString("en-US")}, but none show in these dates. Widen the dates to see them.` };
  return { tone: "differs", text: `${what} counted ${l.expect.toLocaleString("en-US")}; this list has ${rows.toLocaleString("en-US")}. Today counts a little differently, so the two can differ by a few.` };
}

/** Hold the link for one hop, then open the page. Every Today button that opens another page with a count behind it goes through this. */
export function goWith(go: (view: DeepLink["view"], location?: string) => void, link: DeepLink): void { setDeepLink(link); go(link.view, link.location ?? undefined); }
