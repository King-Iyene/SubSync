// Pure helper: put a long flat list of screens under a few plain group names. Nothing is dropped: a screen no group names lands in "More".
export type TabGroup = { label: string; tip: string; keys: string[] };
export type ShownGroup = { label: string; tip: string; keys: string[] };

export function groupTabs(groups: readonly TabGroup[], available: readonly string[]): ShownGroup[] {
  const have = new Set(available);
  const used = new Set<string>();
  const out: ShownGroup[] = [];
  for (const g of groups) {
    const keys = g.keys.filter((k) => have.has(k) && !used.has(k));
    keys.forEach((k) => used.add(k));
    if (keys.length) out.push({ label: g.label, tip: g.tip, keys });
  }
  const rest = available.filter((k) => !used.has(k));
  if (rest.length) out.push({ label: "More", tip: "Other pages.", keys: rest });
  return out;
}

/** The group a screen sits in (index into the shown groups), 0 when unknown. */
export function groupIndexOf(shown: readonly ShownGroup[], key: string): number {
  const i = shown.findIndex((g) => g.keys.includes(key));
  return i < 0 ? 0 : i;
}
