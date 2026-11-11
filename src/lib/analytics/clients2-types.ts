// Clients v2 (client-account management): response types of GET /api/app/clients2?part=... (types only: no imports, safe for the browser).
// REAL data only. Plan facts are exactly what the platform's SaaS endpoints returned; anything the platform does not give says so in words (never a guess).
// Plain words everywhere: "client accounts", "paid plan", "payment status". Definitions: docs/METRICS.md "Clients v2".

export const CL2_PARTS = ["list", "account", "plans", "today", "options", "notes", "views", "export"] as const;
export type Cl2Part = (typeof CL2_PARTS)[number];

export const CL2_FLAGS = ["cl2_accounts", "cl2_account_page", "cl2_plans", "cl2_notes", "cl2_bulk", "cl2_team_move"] as const;
export type Cl2Flag = (typeof CL2_FLAGS)[number];

/** How the platform describes the account's paid plan right now. "paid" and the others are the mapped subscription status; "none" = the account is not on a plan you sell. */
export type PayKey = "paid" | "past_due" | "cancelled" | "paused" | "other" | "none" | "unknown";
/** What we could read: a plan ("ok"), no plan ("no_plan"), the platform said 401 or 403 ("needs_permission"), anything else ("not_available"), never read ("not_checked"). */
export type PlanState = "ok" | "no_plan" | "needs_permission" | "not_available" | "not_checked";

export type Cl2Plan = {
  state: PlanState; name: string | null;
  /** Mapped payment status and its plain label ("Paid up", "Past due", "Cancelled", "Paused", "Other: <raw>", "Not on a paid plan from you"). */
  pay: PayKey; payLabel: string; statusRaw: string | null;
  /** Price per month in the plan's currency (a yearly price divided by 12). An estimate of what the plan brings in; null when the platform gave no price. */
  monthly: number | null; currency: string | null; interval: string | null; priceAmount: number | null;
  /** When we first saw this status (our own record; history starts then). Null until we have seen a change or the first read. */
  since: string | null; daysInStatus: number | null;
  /** One plain line: what this means and what to do. */
  explain: string;
  checkedAt: string | null;
};

export type Cl2Row = {
  locationId: string; name: string; email: string | null; vertical: string | null; verticalLabel: string | null; manager: string | null;
  plan: Cl2Plan;
  level: "ok" | "watch" | "act" | "unknown"; summary: string | null; waiting: number; openValue: number;
  lastActivityAt: string | null; quietDays: number | null; quiet: boolean;
  people: number; peopleQuiet: number;
  url: string | null;
};

export type Cl2Facet = { key: string; label: string; count: number };
export type Cl2Options = {
  total: number;
  status: Cl2Facet[]; plan: Cl2Facet[]; health: Cl2Facet[]; vertical: Cl2Facet[]; manager: Cl2Facet[];
  verticals: Array<{ value: string; label: string }>;
  quietDays: number;
};

export type Cl2List = {
  rows: Cl2Row[]; total: number; /** Position-free cursor for the next page, or null at the end. */ next: string | null; size: number;
  /** Totals of the unfiltered set so the screen can say "12 of 40". */ all: number;
};

export type Cl2Attention = {
  rows: Array<Cl2Row & { note: string | null; noteAt: string | null }>;
  total: number; next: string | null;
  /** Money at risk: plan price per month, per currency (never summed across currencies). Estimate. */
  atRisk: Array<{ currency: string; monthly: number; accounts: number }>;
  needPermission: boolean; notChecked: boolean; sinceNote: string | null;
};

export type Cl2Today = {
  headline: string;
  button: { label: string; kind: "plans" | "attention" | "setup" | "accounts"; status?: string; level?: string; count: number } | null;
  tiles: Array<{ key: string; label: string; count: number; filter: { status?: string; level?: string; quiet?: boolean; plan?: string } }>;
  atRisk: Array<{ currency: string; monthly: number; accounts: number }>;
  planAccess: "ok" | "needs_permission" | "no_data" | "not_checked";
};

export type Cl2Note = { id: string; kind: "note" | "next_step" | "promise" | "plan"; body: string; pinned: boolean; done: boolean; dueOn: string | null; author: string | null; createdAt: string; updatedAt: string };

export type Cl2Account = {
  locationId: string; name: string; email: string | null; url: string | null;
  row: Cl2Row;
  plan: Cl2Plan & { subscriptionId: string | null; trialDays: number | null; userLimit: number | null; contactLimit: number | null; httpStatus: number | null; reason: string | null; history: Array<{ at: string; from: string | null; to: string | null }>; historyStarts: string | null };
  wallet: { state: "ok" | "needs_permission" | "not_checked" | "not_available"; balance: number | null; credits: number | null; checkedAt: string | null; message: string };
  usage: { contacts: number | null; contactLimit: number | null; users: number | null; userLimit: number | null };
  activity: { lastInboundAt: string | null; lastOutboundAt: string | null; nextAppointmentAt: string | null; lastAppointmentAt: string | null; lastSyncAt: string | null; lastContactAt: string | null };
  health: { level: Cl2Row["level"]; summary: string | null; reasons: Array<{ reason: string; label: string; why: string; count: number }>; historyStarts: string | null };
  work: { openValue: number; staleDealsPct: number | null; staleDealsN: number; openDeals: number; medianReplyMinutes: number | null; waiting: number; waitingOld: number; showRate: number | null; showRateN: number; unmarked: number; noshows: number; newLeads: number; wonValue: number };
  setup: { connected: boolean; syncOld: boolean; message: string | null; scopes: { calendar: string; users: string }; channelsSeen: string[]; needsHelp: string[]; contacts: number; conversations: number; appointments: number; deals: number };
  team: { people: number; quiet: number };
  apps: { available: false; message: string };
  checklist: Array<{ id: string; ok: boolean; text: string }>;
  receipt: { lines: string[]; weekStart: string; enough: boolean } | null;
  summary: string;
  notes: Cl2Note[];
};

export type Cl2View = { id: string; name: string; filters: Record<string, string> };
export type Cl2Meta = { generatedAt: string; cached: boolean; canSeeAccounts: boolean; flags: Record<string, boolean> };
