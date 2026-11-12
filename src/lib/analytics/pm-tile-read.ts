// Client payments tiles: a count of 0 from a read SubSync was never allowed to make is not good news. This says, per tile, whether the numbers behind it could be read at all.
// Pure (no database, safe for the browser). Disputes are entered by the owner, so that tile is always readable.
export type PmSourceLite = { key: string; state: "ok" | "needs_permission" | "not_available" | "not_checked"; message: string | null };
export type PmTileKey = "failed" | "late" | "past_due_plans" | "disputes" | "refunds";

const NEEDS: Record<PmTileKey, string[]> = { failed: ["transactions", "subscriptions"], late: ["invoices"], past_due_plans: ["plans"], disputes: [], refunds: ["transactions"] };

/** `readable` is false when none of the sources the tile needs has been read; `note` then says why in plain words. With no source information at all (nothing checked yet) the tile is treated as readable, as before. */
export function tileRead(key: PmTileKey, sources: readonly PmSourceLite[]): { readable: boolean; note: string | null } {
  const need = NEEDS[key];
  if (need.length === 0 || sources.length === 0) return { readable: true, note: null };
  const mine = sources.filter((s) => need.includes(s.key));
  if (mine.length === 0 || mine.some((s) => s.state === "ok")) return { readable: true, note: null };
  const pick = mine.find((s) => s.state === "needs_permission") ?? mine.find((s) => s.state === "not_available") ?? mine[0];
  return { readable: false, note: pick.message ?? (pick.state === "needs_permission" ? "Needs permission: reconnect" : pick.state === "not_available" ? "Not available from the platform yet" : "Not checked yet") };
}
