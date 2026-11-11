// Cash features, response types of GET /api/app/cash?part=... (types only, safe for the browser). REAL synced data only; every dollar figure is an estimate and says so;
// every count equals the rows of the list it opens. Definitions: docs/METRICS.md "Cash features".
import type { RecoverKind, SaveAccount } from "./cash-intel";

export const CF_PARTS = ["save", "recover", "recover-list", "deals", "deals-list", "settings", "options", "team"] as const;
export type CfPart = (typeof CF_PARTS)[number];
export const CF_FLAGS = ["cf_save", "cf_recover", "cf_deals", "cf_email", "cf_record"] as const;

export type CfMeta = { generatedAt: string; cached: boolean; level: "all" | "account" | "self"; flags: Record<string, boolean>; problem: string | null; timezone: string };

export type CfSave = {
  accounts: SaveAccount[]; more: number; checked: number; muted: Array<{ id: string; locationId: string; name: string; until: string }>;
  formula: string; historyStarts: string | null; headline: string;
};

export type CfRecoverRow = {
  key: string; locationId: string; accountName: string; contactId: string; name: string; kind: RecoverKind; kindLabel: string; detail: string;
  since: string; waitingHours: number; estValue: number | null; valueBasis: "deal" | "average" | null; ownerId: string | null; ownerName: string | null; snoozedUntil: string | null; url: string | null;
};
export type CfRecoverSummary = {
  /** Open rows, not snoozed, per kind. The same numbers the lists below return as `total`. */
  counts: Record<RecoverKind, number>; total: number; snoozed: number;
  /** Sum of the estimates; null when no row has an honest estimate. */
  estValue: number | null; valued: number; formula: string;
  recovered: { count: number; value: number | null; days: number };
  historyStarts: string | null; headline: string;
};
export type CfRecoverList = { rows: CfRecoverRow[]; total: number; next: string | null; size: number; kind: RecoverKind | "all"; snoozedView: boolean };

export type CfDealRow = {
  key: string; locationId: string; accountName: string; opportunityId: string; contactId: string | null; name: string; dealName: string | null; kind: "stale" | "soon" | "lost";
  stageName: string | null; value: number; daysInStage: number | null; limitDays: number | null; limitIsEstimate: boolean; lostReason: string | null; ownerId: string | null; flaggedAt: string; url: string | null; why: string;
};
export type CfDealsSummary = {
  stale: { count: number; value: number | null; valued: number }; soon: { count: number; value: number | null; valued: number };
  lost: { count: number; value: number | null; noReason: number; days: number }; moved: { count: number; value: number | null; days: number };
  formula: string; historyStarts: string | null; headline: string;
};
export type CfDealsList = { rows: CfDealRow[]; total: number; next: string | null; size: number; kind: "slipping" | "stale" | "soon" | "lost" };

export type CfSettings = { saveOn: boolean; saveHour: number; quietDays: number[]; quietFrom: number | null; quietTo: number | null; recipients: string[]; timezone: string; canEdit: boolean; sendingNote: string };
export type CfOptions = { accounts: Array<{ locationId: string; name: string }> };
export type CfTeam = { members: Array<{ id: string; name: string }>; me: string | null; canAssign: boolean };
