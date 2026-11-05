// The list of tags an account has, for the tag picker. Pure helpers (the network part is in analytics/contact-tags.ts).

export type TagOption = { name: string; count: number };

/** Joins pages of tag names from the CRM into one list, without repeats (names are compared without caring about capitals). Stops asking when a page adds nothing new, so an endpoint that ignores paging cannot loop. */
export async function readAllPages(fetchPage: (skip: number) => Promise<string[]>, opts: { pageSize?: number; maxPages?: number } = {}): Promise<string[]> {
  const size = opts.pageSize ?? 100, max = opts.maxPages ?? 50;
  const seen = new Map<string, string>();
  for (let page = 0; page < max; page++) {
    const names = await fetchPage(page * size);
    let added = 0;
    for (const n of names) { const k = n.trim().toLowerCase(); if (k && !seen.has(k)) { seen.set(k, n.trim()); added++; } }
    if (added === 0 || names.length < size) break;
  }
  return [...seen.values()];
}

/** CRM tags first by how many contacts use them (most used first), then the rest A to Z. Tags only found on contacts are included too. */
export function rankTags(crm: string[], used: Map<string, number>): TagOption[] {
  const out = new Map<string, TagOption>();
  for (const n of crm) out.set(n.toLowerCase(), { name: n, count: used.get(n.toLowerCase()) ?? 0 });
  for (const [k, c] of used) if (!out.has(k)) out.set(k, { name: k, count: c });
  return [...out.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/** What the picker shows for a typed word: recent tags first (when nothing is typed), then matches (starts-with before contains), never a tag the contact already has. */
export function filterTags(all: TagOption[], q: string, have: string[], recent: string[] = []): { options: TagOption[]; canCreate: boolean } {
  const haveSet = new Set(have.map((t) => t.toLowerCase()));
  const pool = all.filter((t) => !haveSet.has(t.name.toLowerCase()));
  const term = q.trim().toLowerCase();
  if (!term) {
    const r = recent.map((n) => pool.find((t) => t.name.toLowerCase() === n.toLowerCase())).filter((t): t is TagOption => Boolean(t));
    const rest = pool.filter((t) => !r.includes(t));
    return { options: [...r, ...rest], canCreate: false };
  }
  const starts = pool.filter((t) => t.name.toLowerCase().startsWith(term));
  const contains = pool.filter((t) => !t.name.toLowerCase().startsWith(term) && t.name.toLowerCase().includes(term));
  const exact = all.some((t) => t.name.toLowerCase() === term) || haveSet.has(term);
  return { options: [...starts, ...contains], canCreate: !exact && term.length <= 60 && !/[,\n\r]/.test(term) };
}

/** Splits a name around the typed word so the match can be highlighted. */
export function highlight(name: string, q: string): Array<{ text: string; hit: boolean }> {
  const term = q.trim().toLowerCase();
  const i = term ? name.toLowerCase().indexOf(term) : -1;
  if (i < 0) return [{ text: name, hit: false }];
  return [{ text: name.slice(0, i), hit: false }, { text: name.slice(i, i + term.length), hit: true }, { text: name.slice(i + term.length), hit: false }].filter((p) => p.text);
}
