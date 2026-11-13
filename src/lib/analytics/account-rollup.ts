import type { AccountRow, AccountSettings } from "./derive.ts";
import type { AccountHistory } from "./queries.ts";

// Round 6 speed: the finished numbers of every client account, stored one row per account (migration 20261229090000), so "all accounts with numbers" is one indexed lookup.
// The numbers are the SAME ones accountRows() and scoreHistory() produce (they are stored, never recomputed another way); this file only decides when a stored row may be used.
// A row is used only when: it was made under today's counting rules (settings key), no change was made through SubSync since (dirty), it is not too old, and it covers
// exactly the installation's current client accounts. Anything else falls back to the live query, which then refreshes the rows. Before the migration is applied everything falls back.

export const ROLLUP_FRESH_MS = 10 * 60_000;
export const ROLLUP_STALE_MS = 60 * 60_000;

type KeyInput = AccountSettings & { dealRulesRevision?: number };
/** Which counting rules a stored row was made under. */
export function settingsKey(s: KeyInput): string {
  return [s.staleDays, s.slaHours, s.speedTargetMinutes ?? 15, s.dealRulesRevision ?? 0].join("|");
}

export type StoredRow = { locationId: string; ord: number; key: string; computedAt: number; dirty: boolean; row: AccountRow; history: AccountHistory };
export type Verdict = "fresh" | "stale" | "unusable";

/** Pure decision: may these stored rows stand in for the live query? "stale" = usable now but a refresh should start in the background. */
export function judge(rows: StoredRow[], locationCount: number, key: string, now: number): Verdict {
  if (rows.length === 0 || rows.length !== locationCount) return "unusable";
  let oldest = now;
  for (const r of rows) {
    if (r.key !== key || r.dirty) return "unusable";
    if (r.computedAt < oldest) oldest = r.computedAt;
  }
  const age = now - oldest;
  return age <= ROLLUP_FRESH_MS ? "fresh" : age <= ROLLUP_STALE_MS ? "stale" : "unusable";
}

/** Stored rows in the live query's own order (the order is stored, never re-sorted). */
export function assemble(rows: StoredRow[]): { rows: AccountRow[]; history: Map<string, AccountHistory> } {
  const sorted = [...rows].sort((a, b) => a.ord - b.ord);
  return { rows: sorted.map((r) => r.row), history: new Map(sorted.map((r) => [r.locationId, r.history])) };
}

/** What goes into the table for one set of live rows (pure, so a test can compare it with what comes back). */
export function toStored(rows: AccountRow[], history: Map<string, AccountHistory>, s: KeyInput, now: number): StoredRow[] {
  const key = settingsKey(s);
  return rows.map((r, i) => ({ locationId: r.locationId, ord: i, key, computedAt: now, dirty: false, row: r, history: history.get(r.locationId) ?? { scores: [], newContacts: [] } }));
}

/** Changes that cannot alter any stored number (a notification read mark, feedback, help): they do not dirty the rollup. */
export const DIRTY_EXEMPT = /^(notifications|feedback|help|roadmap|news|guides|ai|my-connections|team-connections|meeting-[a-z-]+|segments|search)$/;
