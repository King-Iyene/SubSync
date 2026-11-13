import { sql } from "../db";
import { NO_SOURCE, sourceLabel } from "./speed-intel";

// The values a filter box can suggest: the sources and tags that already exist on the caller's leads, most used first, with how many leads carry each.
// Read only, and only labels (never a person). The accounts come from the verified session (`allowed`), never from the request; null means every account of the installation.
// A prefix typed by the person narrows on the server and the answer is capped, so an account with thousands of distinct tags stays fast ("type to search more").
export const OPTION_CAP = 30;
export type OptionKind = "source" | "tag";
export type FilterOption = { value: string; count: number };
export type FilterOptions = { values: FilterOption[]; more: boolean };
export const isOptionKind = (v: unknown): v is OptionKind => v === "source" || v === "tag";

/** Sources are matched by their label (see sourceLabel), so "facebook ads" and "Facebook ads" are one choice. Counts add up; most used first, then A to Z. */
export function mergeSources(rows: ReadonlyArray<{ value: string | null; count: number }>, cap = OPTION_CAP): FilterOptions {
  const by = new Map<string, number>();
  for (const r of rows) { const l = sourceLabel(r.value); if (l === NO_SOURCE) continue; by.set(l, (by.get(l) ?? 0) + Number(r.count)); }
  return capped([...by].map(([value, count]) => ({ value, count })), cap);
}
/** Tags are matched without regard to case (the filter itself does that), so they come back in lower case. */
export function mergeTags(rows: ReadonlyArray<{ value: string | null; count: number }>, cap = OPTION_CAP): FilterOptions {
  const by = new Map<string, number>();
  for (const r of rows) { const v = (r.value ?? "").replace(/\s+/g, " ").trim().toLowerCase(); if (v) by.set(v, (by.get(v) ?? 0) + Number(r.count)); }
  return capped([...by].map(([value, count]) => ({ value, count })), cap);
}
function capped(all: FilterOption[], cap: number): FilterOptions {
  all.sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
  return { values: all.slice(0, cap), more: all.length > cap };
}
/** What the person typed, cleaned for a prefix search. */
export const cleanPrefix = (q: string | null | undefined) => (q ?? "").replace(/\s+/g, " ").trim().slice(0, 60).toLowerCase();

export type OptionsInput = { installationId: string; allowed: string[] | null; kind: OptionKind; q: string; fromMs?: number | null; toMs?: number | null };

export async function filterOptions(i: OptionsInput): Promise<FilterOptions> {
  const db = sql();
  const q = cleanPrefix(i.q);
  const scope = i.allowed ? db`and c.location_id = any(${i.allowed}::text[])` : db``;
  const when = i.fromMs != null && i.toMs != null ? db`and c.date_added >= ${new Date(i.fromMs)} and c.date_added < ${new Date(i.toMs)}` : db``;
  // Over-ask a little: two spellings of one source merge afterwards, so the cap is applied to the merged list.
  const take = OPTION_CAP * 3 + 1;
  if (i.kind === "source") {
    const rows = await db`select btrim(c.source) v, count(*)::int n from cached_contacts c join locations l on l.installation_id = c.installation_id and l.location_id = c.location_id
      where c.installation_id = ${i.installationId} and not l.ignored and btrim(coalesce(c.source, '')) <> '' ${scope} ${when}
        ${q ? db`and starts_with(lower(btrim(c.source)), ${q})` : db``}
      group by 1 order by n desc, v limit ${take}`;
    return mergeSources(rows.map((r) => ({ value: r.v as string, count: r.n as number })));
  }
  const rows = await db`select lower(btrim(t)) v, count(*)::int n from cached_contacts c join locations l on l.installation_id = c.installation_id and l.location_id = c.location_id, unnest(c.tags) t
    where c.installation_id = ${i.installationId} and not l.ignored and btrim(t) <> '' ${scope} ${when}
      ${q ? db`and starts_with(lower(btrim(t)), ${q})` : db``}
    group by 1 order by n desc, v limit ${take}`;
  return mergeTags(rows.map((r) => ({ value: r.v as string, count: r.n as number })));
}
