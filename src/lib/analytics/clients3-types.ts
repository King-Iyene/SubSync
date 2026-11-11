// Clients module, round 3: response types of GET /api/app/clients3?part=... (types only: no imports, safe for the browser).
// REAL synced data only. Anything under its minimum is { enough: false } (screen says "not enough data"). Trends are from our own timestamps;
// history-based figures carry `historyStarts` (YYYY-MM-DD). No invented scores or "churn probability". Definitions: docs/METRICS.md "Clients 3".

export const CL3_PARTS = ["overview", "needs-attention", "trends", "compare", "receipt", "people", "setup", "list", "options", "export"] as const;
export type Cl3Part = (typeof CL3_PARTS)[number];

/** Shared query parameters (all optional): from, to (ISO dates, default last 30 days), location (one account id), q (account name search), sort, dir, page (0-based), size (20|50|100),
 *  reason (a Cl3Reason, for part=list), grain (week|month, trends), ids (two account ids, compare), week (Monday YYYY-MM-DD, receipt), industry, level (Cl3Level). */
export type Cl3Query = {
  part: Cl3Part; from?: string; to?: string; location?: string; q?: string; sort?: string; dir?: "asc" | "desc"; page?: number; size?: 20 | 50 | 100;
  reason?: Cl3Reason; grain?: "week" | "month"; ids?: string; week?: string; industry?: string; level?: Cl3Level;
};

export type Rate = { value: number | null; n: number; of: number; enough: boolean };
export type Page<T> = { rows: T[]; total: number; page: number; size: number; pages: number; truncated: boolean };
export type Delta = { current: number; previous: number; change: number | null; enough: boolean };

/** Each reason is a count that opens exactly its rows (part=list&reason=...). */
export const CL3_REASONS = [
  "leads_down", "waiting", "waiting_old", "unmarked", "noshows", "stale_deals", "no_owner", "no_phone", "staff_quiet", "sync_old", "needs_permission",
] as const;
export type Cl3Reason = (typeof CL3_REASONS)[number];
export type Cl3Level = "ok" | "watch" | "act" | "unknown";

export type Cl3ReasonCount = { reason: Cl3Reason; count: number; label: string; /** One plain line: why it matters. */ why: string };

/** One row per client account. Every number is for the chosen period unless named otherwise. */
export type Cl3Account = {
  locationId: string; name: string; industry: string | null;
  level: Cl3Level; /** Plain sentence, for example "9 leads waiting over a day, leads down 38%". Null when level is ok or unknown. */ summary: string | null;
  reasons: Cl3ReasonCount[];
  newLeads: Delta; booked: Delta; wonValue: Delta;
  waiting: number; waitingOld: number; medianReplyMinutes: number | null; unmarked: number; noshows: number; staleDealsPct: Rate; openValue: number;
  staffMessages: Delta; staffActive: number; staffIdle: number;
  noOwnerPct: Rate; noPhonePct: Rate;
  lastSyncAt: string | null; syncOld: boolean; needsPermission: string[];
  /** 8 weekly points of new leads, oldest first, for a sparkline. */
  sparkLeads: number[];
  historyStarts: string | null; enough: boolean; url: string | null;
};

export type Cl3Today = { headline: string; button: { label: string; reason: Cl3Reason; locationId: string | null; count: number } | null };

export type Cl3Overview = {
  period: { from: string; to: string; days: number };
  today: Cl3Today;
  accounts: number; ok: number; watch: number; act: number; unknown: number;
  totals: { newLeads: Delta; booked: Delta; wonValue: Delta; waiting: number; unmarked: number };
  topReasons: Cl3ReasonCount[];
  /** Worst first, at most 5; the full ranking is part=needs-attention. */
  worst: Cl3Account[];
  historyStarts: string | null;
};

export type Cl3Attention = Page<Cl3Account> & { levels: { act: number; watch: number; ok: number; unknown: number } };

export type Cl3TrendPoint = { start: string; newLeads: number; booked: number; showed: number; noshow: number; won: number; wonValue: number; staffMessages: number; waitingEnd: number | null };
export type Cl3Trends = {
  grain: "week" | "month"; currentFrom: string; previousFrom: string;
  /** Agency total (or the one account when location is set), oldest first. Weeks with no recorded day are null-free zeros only after historyStarts. */
  points: Cl3TrendPoint[];
  /** Per account: this period against the one before (week-on-week or month-on-month by grain). */
  rows: Page<{ locationId: string; name: string; newLeads: Delta; booked: Delta; wonValue: Delta; staffMessages: Delta; spark: number[] }>;
  historyStarts: string | null;
};

export type Cl3Side = {
  locationId: string; name: string; industry: string | null; level: Cl3Level;
  newLeads: number; booked: number; showRate: Rate; waiting: number; medianReplyMinutes: number | null; wonValue: number; openValue: number; staleDealsPct: Rate; staffMessages: number; noOwnerPct: Rate; spark: number[];
};
export type Cl3Compare = { sides: Cl3Side[]; period: { from: string; to: string } };

export type Cl3Receipt = {
  locationId: string; name: string; weekStart: string; weekEnd: string; enough: boolean;
  cameIn: number; cameInPrev: number; answered: number; answeredFast: number; stillWaiting: number; medianReplyMinutes: number | null;
  booked: number; showed: number; noshow: number; unmarked: number;
  dealsStarted: number; won: number; wonValue: number; lostValue: number;
  /** Plain lines safe to paste to the client, no internal terms. */
  lines: string[]; historyStarts: string | null;
};
export type Cl3ReceiptList = { weekStart: string; rows: Page<Cl3Receipt>["rows"]; total: number };

export type Cl3Person = {
  userId: string; name: string; locationId: string; accountName: string;
  messagesSent: number; leadsTouched: number; lastActiveAt: string | null; idleDays: number | null; idle: boolean;
};
export type Cl3People = Page<Cl3Person> & { idleCount: number; accountsWithoutStaff: number };

export type Cl3Setup = {
  locationId: string; name: string; connected: boolean; lastSyncAt: string | null; syncOld: boolean;
  scopes: { calendar: "ok" | "needs_permission" | "unknown"; users: "ok" | "needs_permission" | "unknown" };
  /** "Needs permission: reconnect" when a scope is missing, otherwise null. */
  message: string | null; contacts: number; conversations: number; appointments: number; deals: number;
};
export type Cl3SetupList = Page<Cl3Setup> & { needAction: number };

export type Cl3ListRow = {
  locationId: string; accountName: string; contactId: string | null; contactName: string; detail: string | null; at: string | null; value: number | null; url: string | null;
};
export type Cl3List = Page<Cl3ListRow> & { reason: Cl3Reason; label: string };

export type Cl3Options = { accounts: { locationId: string; name: string }[]; industries: string[] };

/** Every JSON response also carries these. */
export type Cl3Meta = { generatedAt: string; cached: boolean; canSeeAccounts: boolean; flags: Record<string, boolean>; problem: string | null };

export const CL3_FLAGS = ["cl_overview", "cl_attention", "cl_trends", "cl_compare", "cl_reports", "cl_people", "cl_setup", "cl_rollup", "cl_module"] as const;
export type Cl3Flag = (typeof CL3_FLAGS)[number];
