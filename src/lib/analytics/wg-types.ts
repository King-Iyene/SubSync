// Wallet guard, response types of GET /api/app/wg?part=... (types only, safe for the browser). REAL data only: the balance the platform returned, and SubSync's own readings of it.
// Spend, burn rate, days left and spikes are ESTIMATES and carry their formula; under the minimums there is no figure, only "not enough data". Definitions: docs/METRICS.md "Wallet guard".
import type { Level } from "./wg-core";

export const WG_PARTS = ["summary", "list", "account", "settings", "usage", "options"] as const;
export type WgPart = (typeof WG_PARTS)[number];
export const WG_FLAGS = ["wg_wallet", "wg_record", "wg_alerts"] as const;
export const WG_BUCKETS = ["all", "empty", "low", "spike", "unknown", "paused"] as const;
export type WgBucket = (typeof WG_BUCKETS)[number];

export type WgMeta = { generatedAt: string; cached: boolean; level: "all" | "account" | "self"; flags: Record<string, boolean>; problem: string | null };

export type WgRow = {
  locationId: string; name: string; balance: number | null; credits: number | null; level: Level;
  state: "ok" | "needs_permission" | "not_available" | "not_checked"; observedAt: string | null;
  burnPerDay: number | null; daysLeft: number | null; spent7d: number | null; topups7d: number; spike: boolean; spikeSpent: number | null; spikeBaseline: number | null;
  readings: number; enough: boolean; why: string; lowAmount: number; ruleAmount: number | null; pausedUntil: string | null; url: string | null;
};

export type WgSummary = {
  accounts: number; counts: Record<WgBucket, number>; headline: string; needsPermission: number; top: WgRow[];
  formulaBurn: string; formulaSpike: string; historyStarts: string | null;
  prefs: { lowAmount: number; lowDays: number; alertsOn: boolean; spikeOn: boolean };
  /** The platform has no way to read the auto-recharge setting, so it is never guessed. */
  autoRecharge: { available: false; note: string };
};
export type WgList = { rows: WgRow[]; total: number; page: number; size: number; pages: number; bucket: WgBucket };
export type WgAccount = {
  row: WgRow;
  series: Array<{ day: string; spent: number; topups: number; covered: boolean }>;
  balances: Array<{ at: string; balance: number }>;
  events: Array<{ id: number; kind: "low" | "empty" | "spike" | "recharge"; at: string; text: string }>;
};
export type WgSettings = {
  canEdit: boolean; lowAmount: number; lowDays: number; alertsOn: boolean; spikeOn: boolean; watching: boolean; sendingNote: string;
  rules: Array<{ locationId: string; name: string; lowAmount: number | null; pausedUntil: string | null }>;
};
export type WgUsage = {
  state: "ok" | "needs_permission" | "not_available"; days: number; total: number | null;
  byType: Array<{ type: string; amount: number; count: number }>; byDay: Array<{ day: string; amount: number }>; note: string;
};
