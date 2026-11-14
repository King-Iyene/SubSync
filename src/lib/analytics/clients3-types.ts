// Clients module, round 3: response types of GET /api/app/clients3?part=... (types only: no imports, safe for the browser).
// REAL synced data only. Anything under its minimum is { enough: false } (screen says "not enough data"). Trends are from our own timestamps;
// history-based figures carry `historyStarts` (YYYY-MM-DD). No invented scores or "churn probability". Definitions: docs/METRICS.md "Clients 3".

export const CL3_PARTS = ["overview", "needs-attention", "trends", "compare", "receipt", "people", "setup", "list", "options", "export", "billing", "money", "money-history"] as const;
export type Cl3Part = (typeof CL3_PARTS)[number];

/** Shared query parameters (all optional): from, to (ISO dates, default last 30 days), location (one account id), q (account name search), sort, dir, page (0-based), size (20|50|100),
 *  reason (a Cl3Reason, for part=list), grain (week|month, trends), ids (two account ids, compare), week (Monday YYYY-MM-DD, receipt), industry, level (Cl3Level). */
export type Cl3Query = {
  part: Cl3Part; from?: string; to?: string; location?: string; q?: string; sort?: string; dir?: "asc" | "desc"; page?: number; size?: 20 | 50 | 100;
  reason?: Cl3Reason; bucket?: string; plan?: string; cursor?: string; grain?: "week" | "month"; ids?: string; week?: string; industry?: string; level?: Cl3Level;
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
  /** Quiet marks on this account right now (all, replies, noshows, stale, renewal): the matching reasons are left out of the ranking and the counts stay real. */
  quieted?: string[];
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
  /** Channels we actually saw messages on in the last 30 days (sms, email, whatsapp, call, chat), from real message records. Empty means none seen, not "not connected". */
  channelsSeen: string[]; /** Team members the platform lists for this account (0 = none found, or users permission missing). */ users: number; usersState: "ok" | "needs_permission" | "unknown"; needsHelp: string[];
};
export type Cl3SetupList = Page<Cl3Setup> & { needAction: number };

export type Cl3ListRow = {
  locationId: string; accountName: string; contactId: string | null; contactName: string; detail: string | null; at: string | null; value: number | null; url: string | null;
};
export type Cl3List = Page<Cl3ListRow> & { reason: Cl3Reason; label: string };

export type Cl3Options = { accounts: { locationId: string; name: string }[]; industries: string[] };

/** Every JSON response also carries these. */
export type Cl3Meta = { generatedAt: string; cached: boolean; canSeeAccounts: boolean; flags: Record<string, boolean>; problem: string | null };

export const CL3_FLAGS = ["cl_overview", "cl_attention", "cl_trends", "cl_compare", "cl_reports", "cl_people", "cl_setup", "cl_billing", "cl_rollup", "cl_module"] as const;
export type Cl3Flag = (typeof CL3_FLAGS)[number];

/** Billing view (part=billing): the plan and subscription status the platform reports per account. paymentFailing, nextPaymentAt and appsInstalled are ALWAYS null today: the platform API does not provide them, and the screen says "Not available from the platform yet". */
export type Cl3Billing = {
  locationId: string; name: string; state: "ok" | "no_plan" | "needs_permission" | "not_available" | "not_checked";
  plan: string | null; subscriptionStatus: string | null; paymentFailing: null; nextPaymentAt: null; appsInstalled: null; fetchedAt: string | null; message: string | null;
};
export type Cl3BillingList = Page<Cl3Billing> & { needPermission: number; notActive: number };

// ---- Clients v3: money control center (parts money, money-history). Real synced data only; what the platform cannot give is null and the screen says "Not available from the platform yet". ----
export const CL3_BUCKETS = ["all", "unpaid", "failing", "no_plan", "paid", "empty_wallet", "app_missing", "trial", "app_trial"] as const;
export type Cl3Bucket = (typeof CL3_BUCKETS)[number];
export const CL3_MONEY_FLAGS = ["cl3_money", "cl3_apps", "cl3_history", "pr_report", "pr_page", "pr_auto"] as const;

export type Cl3MoneyRow = {
  locationId: string; name: string; email: string | null;
  plan: { name: string | null; pay: string; payLabel: string; statusRaw: string | null; monthly: number | null; currency: string | null; interval: string | null; daysInStatus: number | null; since: string | null; state: string; explain: string };
  level: "ok" | "watch" | "act" | "unknown"; summary: string | null;
  /** The platform's credit balance as it reports it (units not stated by the platform); null when not read. */
  wallet: { balance: number | null; state: string | null };
  /** Whether SubSync is installed on this account, from the platform's installed list. Other apps cannot be read. */
  subsync: "installed" | "missing" | "unknown";
  /** What the platform's installed list says about SubSync on this account (install date, app plan, trial flag, version id). Null when not read. The platform gives no trial end date: `trialEndsAt` is set only when the install event gave a start and a length. */
  install: { installedAt: string | null; versionId: string | null; planLabel: string | null; onTrial: boolean | null; trialEndsAt: string | null; endingSoon: boolean; line: string } | null;
  /** ALWAYS null today: the platform API does not give a next charge date or a failure reason. */
  nextChargeAt: null; failureReason: null;
  url: string | null;
};
export type Cl3Money = {
  rows: Cl3MoneyRow[]; total: number; next: string | null; size: number;
  summary: {
    accounts: number; counts: Record<Cl3Bucket, number>;
    /** Monthly price of paid plans, per currency. An estimate: the plan price, not what was charged. */
    expectedMonthly: Array<{ currency: string; monthly: number; accounts: number }>;
    /** Monthly price of plans that are past due, cancelled, paused or in an unknown state. Same estimate. */
    atRisk: Array<{ currency: string; monthly: number; accounts: number }>;
    plans: Array<{ key: string; label: string; count: number }>;
    apps: { state: "ok" | "needs_permission" | "not_read"; installed: number; missing: number; unknown: number; onTrial: number; endingSoon: number };
    /** Whether the plan list could be read: ok, needs_permission (reconnect), not_available (the platform does not give it to this app or account), not_checked (never read). */
    planRead: "ok" | "needs_permission" | "not_available" | "not_checked";
    /** Exact permissions to allow, when a read was refused. Empty when none. */
    needsPermission: string[];
    today: { headline: string; bucket: Cl3Bucket | null };
    historyStarts: string | null;
  };
};
export type Cl3HistoryRow = { id: string; locationId: string; name: string; kind: string; text: string; at: string; url: string | null };
export type Cl3HistoryList = { rows: Cl3HistoryRow[]; next: string | null; size: number; historyStarts: string | null };
