// Payments module: shared types (server and browser). Pure, no imports of server code.
// Two kinds of money: "plans" (what the agency's clients pay the agency) and "customers" (what the clients' own customers pay the clients).
export const PM_FLAGS = ["pm_module", "pm_recovery", "pm_disputes", "pm_upcoming", "pm_resend", "pm_checks"] as const;
export type PmFlag = (typeof PM_FLAGS)[number];
export const PM_PARTS = ["today", "queue", "item", "disputes", "upcoming", "history", "options", "setup", "export", "checks"] as const;
export type PmPart = (typeof PM_PARTS)[number];

export type PmKind = "transaction" | "invoice" | "subscription" | "plan";
export type PmProblem = "failed_payment" | "late_invoice" | "past_due_plan" | "failed_subscription" | "refund";
export const PM_PROBLEMS: readonly PmProblem[] = ["failed_payment", "late_invoice", "past_due_plan", "failed_subscription", "refund"];
export const PROBLEM_LABEL: Record<PmProblem, string> = { failed_payment: "Failed payment", late_invoice: "Late invoice", past_due_plan: "Past due plan", failed_subscription: "Failed repeat payment", refund: "Refund" };
export type PmAgeBucket = "0-3" | "4-7" | "8-14" | "15-30" | "31+";
export const AGE_BUCKETS: readonly PmAgeBucket[] = ["0-3", "4-7", "8-14", "15-30", "31+"];

export type PmMeta = { generatedAt: string; flags: Record<string, boolean>; canSee: boolean; problem: string | null; sample?: boolean };
/** Which kind of data the platform did not give us, said in the plain words the screen uses. */
export type PmSource = { key: "plans" | "transactions" | "subscriptions" | "invoices"; label: string; state: "ok" | "needs_permission" | "not_available" | "not_checked"; scope: string; lastOkAt: string | null; message: string | null };

export type PmMoney = { currency: string; amount: number; count: number };
export type PmTile = { key: "failed" | "late" | "past_due_plans" | "disputes" | "refunds"; label: string; count: number; money: PmMoney[]; note: string | null; filter: { problem?: PmProblem | "failed"; disputes?: boolean } };
export type PmToday = {
  headline: string; button: { label: string; count: number } | null; tiles: PmTile[];
  atRisk: Array<PmMoney & { formula: string }>; /** Recovered in the dates asked (the date bar; the last 30 days when none were asked). The name is old, the window is `windowFrom` to `windowTo`. */ recoveredLast30: PmMoney[]; windowFrom?: string; windowTo?: string; avgDaysToRecover: number | null; recoveryRate: number | null;
  historyStarts: string | null; sources: PmSource[]; accounts: number; testRowsHidden: number; setupNote: string | null; expectedMonthly: Array<PmMoney & { formula: string }>;
};
export type PmRow = {
  key: string; locationId: string; accountName: string; kind: PmKind; itemId: string; problem: PmProblem; problemLabel: string; who: string | null; email: string | null; contactId: string | null;
  amount: number | null; currency: string | null; ageDays: number; since: string | null; reason: string; next: string; priority: "high" | "medium" | "low";
  status: "open" | "contacted" | "snoozed"; snoozedUntil: string | null; liveMode: boolean; crmUrl: string | null; planName: string | null;
};
export type PmQueue = { rows: PmRow[]; total: number; next: string | null; totals: PmMoney[]; truncated: boolean };
export type PmItemEvent = { at: string; status: string; from: string | null; amount: number | null; currency: string | null };
export type PmNote = { id: string; action: "contacted" | "snooze" | "dismiss" | "note"; reason: string | null; note: string | null; until: string | null; by: string | null; at: string };
export type PmItem = { row: PmRow; events: PmItemEvent[]; notes: PmNote[]; messages: Array<{ tone: "friendly" | "neutral" | "firm"; label: string; text: string }>; canResend: boolean; resendNote: string };
export type PmDispute = { id: string; locationId: string; accountName: string; customer: string; amount: number | null; currency: string | null; reason: string | null; openedOn: string; evidenceDueOn: string | null; status: "open" | "evidence_sent" | "won" | "lost"; processorUrl: string | null; notes: string | null; daysLeft: number | null; alert: "overdue" | "today" | "tomorrow" | "soon" | null; updatedAt: string };
export type PmDisputes = { rows: PmDispute[]; total: number; open: number; due: number; label: string };
export type PmUpcoming = {
  plans: { state: PmSource["state"]; items: Array<PmMoney & { formula: string; accounts: number }>; note: string };
  customers: { available: boolean; note: string }; missing: string[];
};
export type PmHistory = { windowFrom?: string; windowTo?: string; historyStarts: string | null; days: Array<{ day: string; failed: number; recovered: number; late: number }>; repeat: Array<{ locationId: string; accountName: string; who: string; count: number }>; avgDaysToRecover: number | null; recoveryRate: number | null; recovered: PmMoney[]; flagged: number; fixed: number };
export type PmOptions = { accounts: Array<{ id: string; name: string }>; currencies: string[]; flags: Record<string, boolean>; roleLevel: "agency" | "account"; lastSync: string | null };
export type PmSetup = { sources: PmSource[]; checks: Array<{ key: string; title: string; ok: boolean; detail: string }>; scopes: string[] };
export type WithMeta<T> = T & PmMeta;

export const PM_SCOPES = { plans: "", transactions: "payments/transactions.readonly", subscriptions: "payments/subscriptions.readonly", invoices: "invoices.readonly", wallet: "wallet.readonly", installer: "marketplace-installer-details.readonly" } as const;
