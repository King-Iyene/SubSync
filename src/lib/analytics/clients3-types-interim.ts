// Interim view-model types for the Clients module UI (slice CU). Replace with clients3-types.ts (slice CD) through the adapter once it is merged.
// Every number is from synced CRM data per account and period. Nothing here is a made-up score.
export type ClReasonKey = "waiting" | "slow" | "noshow" | "unmarked" | "stale" | "quiet" | "leads_down" | "no_owner" | "sync";
export type ClReason = { key: ClReasonKey; label: string; count: number };
export type ClAccount = {
  locationId: string; name: string; reasons: ClReason[];
  leads: number; leadsPrev: number; waiting: number; medianReplyMin: number | null;
  booked: number; showed: number; noShow: number; unmarked: number;
  dealsOpen: number; staleShare: number | null; wonCents: number; lostCents: number;
  staffTotal: number; staffActive: number; missingOwner: number; missingPhone: number;
  syncedAt: string | null; connection: "ok" | "reconnect" | "scopes";
};
export type ClPage<T> = { total: number; page: number; pageSize: number; rows: T[] };
export type ClToday = { sentence: string; steps: Array<{ title: string; count: number; accountName: string; locationId: string; reason: ClReasonKey }> };
export type ClOverview = { accounts: number; needAttention: number; healthy: number; today: ClToday; totals: { leads: number; waiting: number; unmarked: number; staleDealsCents: number }; historySince: string | null };
export type ClTrendRow = { locationId: string; name: string; leads: number[]; answeredPct: Array<number | null>; booked: number[]; wonCents: number[]; weeks: string[] };
export type ClReportRow = { locationId: string; name: string; came: number; answered: number; booked: number; showed: number; won: number; wonCents: number; caught: number };
export type ClPerson = { id: string; locationId: string; accountName: string; name: string; sent: number; lastActive: string | null; idle: boolean };
export type ClSetupRow = { locationId: string; name: string; connection: "ok" | "reconnect" | "scopes"; missingScopes: string[]; syncedAt: string | null };
export type ClDrillRow = { id: string; title: string; sub: string; url: string | null };
export type ClPart = "overview" | "accounts" | "trends" | "reports" | "people" | "setup" | "rows";
// Agency-management layer (King's added scope). CD's clients3-types.ts does not have these yet: CD adds them, then this file is replaced by an adapter.
// null means the CRM did not give us the data: the screen says "Needs permission: reconnect".
export type ClBilling = { plan: string; status: "active" | "trial" | "failed" | "cancelled"; failedCount: number; nextPayment: string | null; amountCents: number };
export type ClApps = { installed: number; names: string[]; setupDone: number; setupTotal: number };
export type ClAgencyInfo = { locationId: string; name: string; billing: ClBilling | null; apps: ClApps | null };
export type ClNote = { id: string; text: string; at: string; by: string };
export type ClPart2 = "payments" | "notes" | "agency";
