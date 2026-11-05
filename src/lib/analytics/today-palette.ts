// The command palette of Today and the saved views, as pure rules (no React, no database), so they are unit tested.

export type PaletteCommand = {
  id: string;
  /** "Go to", "Open list", "Client account", "View", "Do": the small word at the start of the line. */
  group: string;
  title: string;
  hint?: string;
  /** Extra words that should find this command ("snooze" finds Done and set aside). */
  keywords?: string;
  disabled?: boolean;
  run: () => void;
};

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");

/** Every typed word must appear somewhere in the command's group, title, hint or keywords. A title that starts with the first word comes first; the page's own order breaks ties. */
export function filterCommands<T extends Pick<PaletteCommand, "group" | "title" | "hint" | "keywords">>(all: T[], query: string): T[] {
  const words = norm(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return all;
  const scored: Array<{ c: T; score: number; n: number }> = [];
  all.forEach((c, n) => {
    const hay = norm(`${c.group} ${c.title} ${c.hint ?? ""} ${c.keywords ?? ""}`);
    if (!words.every((w) => hay.includes(w))) return;
    const title = norm(c.title);
    scored.push({ c, n, score: title.startsWith(words[0]) ? 0 : title.includes(words[0]) ? 1 : 2 });
  });
  return scored.sort((a, b) => a.score - b.score || a.n - b.n).map((x) => x.c);
}

// ---------- saved views ----------

/** What a saved view of Today remembers: which client accounts, and whether test and very old deals are left out. Nothing else (no rows, no names). */
export type TodayView = { accounts: string[]; excludeJunk: boolean };
export const MAX_TODAY_VIEWS = 10;
const ID = /^[A-Za-z0-9_-]{3,64}$/;

export function sanitizeTodayView(v: unknown): TodayView {
  const o = (v && typeof v === "object" ? v : {}) as { accounts?: unknown; excludeJunk?: unknown };
  const accounts = Array.isArray(o.accounts) ? [...new Set(o.accounts.filter((x): x is string => typeof x === "string" && ID.test(x)))].slice(0, 50) : [];
  return { accounts, excludeJunk: o.excludeJunk === true };
}

/** A view's name: 1 to 40 characters, no control characters, trimmed. Anything else is refused. */
export function todayViewName(v: unknown): string | null {
  if (typeof v !== "string") return null;
  // eslint-disable-next-line no-control-regex
  const t = v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return t.length >= 1 && t.length <= 40 ? t : null;
}

/** The sentence a view is listed with. */
export function describeTodayView(v: TodayView, names: ReadonlyMap<string, string>): string {
  const who = v.accounts.length === 0 ? "All clients" : v.accounts.length === 1 ? names.get(v.accounts[0]) ?? "1 client" : `${v.accounts.length} clients`;
  return v.excludeJunk ? `${who}, leaving out test and very old deals` : who;
}
