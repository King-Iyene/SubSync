// The rules of the filter picker (a type-to-search box over values that already exist), kept apart from the screen so they are unit tested.
export type PickValue = { value: string; count: number };
export type PickRow = { kind: "value"; value: string; count: number } | { kind: "use"; value: string };

/** The rows under the box: the suggestions in the order given (most used first), then a 'Use "typed"' row for free text unless the typed text already IS a suggestion. */
export function pickRows(typed: string, values: readonly PickValue[], caseSensitive = false): PickRow[] {
  const t = typed.trim();
  const rows: PickRow[] = values.map((v) => ({ kind: "value", value: v.value, count: v.count }));
  const same = (a: string, b: string) => (caseSensitive ? a === b : a.toLowerCase() === b.toLowerCase());
  if (t && !values.some((v) => same(v.value, t))) rows.push({ kind: "use", value: t });
  return rows;
}

/** Arrow keys wrap around; Home and End jump. Returns the new highlighted row (or the same one for any other key). */
export function moveHighlight(at: number, key: string, count: number): number {
  if (count <= 0) return -1;
  if (key === "ArrowDown") return at < 0 || at >= count - 1 ? 0 : at + 1;
  if (key === "ArrowUp") return at <= 0 ? count - 1 : at - 1;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return at;
}

/** The words that tell the person what the list is: how many are shown and whether there are more to find by typing. */
export function pickStatus(shown: number, more: boolean, loading: boolean, typed: string): string {
  if (loading) return "Looking...";
  if (shown === 0) return typed.trim() ? "Nothing in your account starts with that. You can still use what you typed." : "Nothing in your account yet. You can type an exact value.";
  return more ? `Showing the ${shown} most used. Type to search for more.` : `${shown} found in your account.`;
}
