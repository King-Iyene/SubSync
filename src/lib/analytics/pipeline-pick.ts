import type { sql } from "../db";

type Db = ReturnType<typeof sql>;

// ONE place for "the pipeline the person picked" on every screen that shows deals (King, 13 Nov 2026: the picker did not reach every number).
// A pipeline is picked by its NAME, the way the merged picker lists it ("Sales Pipeline" is one pipeline across accounts); the account picker narrows inside it.
// Pure parts (pipelineParam, pipeKey, inPipeline, pipelineCacheKey) are unit tested; the SQL part needs the deal joins (dealScopeJoins gives sc_pl).

/** The same merge as slug() in pipeline3-intel: trimmed, lower case, spaces collapsed. */
export const pipeKey = (s: string | null | undefined): string => (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
/** The pipeline asked for in an address (`pipeline=`), cleaned, or null for "All pipelines". Never trusted beyond a short name. */
export function pipelineParam(sp: URLSearchParams | { get(k: string): string | null }): string | null {
  const v = (sp.get("pipeline") ?? "").trim().slice(0, 120);
  return v || null;
}
/** True when a deal's pipeline name is the picked one (or nothing was picked). */
export const inPipeline = (name: string | null | undefined, pick: string | null | undefined): boolean => !pick || pipeKey(name) === pipeKey(pick);
/** The key of the picked pipeline for a cache or answer-store key: different pipelines never share an answer. */
export const pipelineCacheKey = (pick: string | null | undefined): string => (pick ? `pl:${pipeKey(pick)}` : "pl:all");

/** `and <the deal's pipeline name matches>` for a query that joined dealScopeJoins() (alias sc_pl). Empty when nothing is picked. */
export function inPipelineSql(db: Db, pick: string | null | undefined) {
  const key = pick ? pipeKey(pick) : null;
  return key ? db`and lower(regexp_replace(btrim(coalesce(sc_pl.name, '')), '[[:space:]]+', ' ', 'g')) = ${key}` : db``;
}
