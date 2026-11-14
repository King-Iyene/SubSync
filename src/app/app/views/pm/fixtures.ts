import { sampleChecks } from "@/lib/analytics/money-checks";
import type { PmDisputes, PmHistory, PmItem, PmMeta, PmOptions, PmPart, PmQueue, PmRow, PmSetup, PmSource, PmToday, PmUpcoming } from "@/lib/analytics/payments-types";

// Typed SAMPLE data, used only behind ?pmfx=1 and always labelled "Sample data". Never mixed with real rows.
const META: PmMeta = { generatedAt: "2026-11-11T09:00:00.000Z", flags: { pm_module: true, pm_recovery: true, pm_disputes: true, pm_upcoming: true, pm_resend: false }, canSee: true, problem: null, sample: true };
const ROW = (o: Partial<PmRow> & Pick<PmRow, "key" | "accountName" | "problem" | "problemLabel">): PmRow => ({ locationId: "loc-" + o.key, kind: "invoice", itemId: o.key, who: "Sample customer", email: "sample@example.com", contactId: null, amount: 100, currency: "USD", ageDays: 3, since: "2026-11-08T00:00:00Z", reason: "The invoice was sent, its due date has passed and it is not fully paid.", next: "Send a friendly reminder with the invoice link, or call them.", priority: "medium", status: "open", snoozedUntil: null, liveMode: true, crmUrl: "#", planName: null, ...o });
const ROWS: PmRow[] = [
  ROW({ key: "s1", accountName: "Sample Dental", problem: "failed_payment", problemLabel: "Failed payment", kind: "transaction", who: "Dana Ortiz", amount: 1450, ageDays: 18, priority: "high", reason: "The card or bank did not accept this payment. The platform does not tell us the exact reason." }),
  ROW({ key: "s2", accountName: "Sample Roofing", problem: "late_invoice", problemLabel: "Late invoice", who: "Ken Mills", amount: 3200, ageDays: 9, priority: "high" }),
  ROW({ key: "s3", accountName: "Sample Med Spa", problem: "past_due_plan", problemLabel: "Past due plan", kind: "plan", who: "Sample Med Spa", email: null, amount: 297, ageDays: 5, planName: "Growth plan", reason: "This client's payment for the plan you sell them is past due. The platform does not tell us the exact reason." }),
  ROW({ key: "s4", accountName: "Sample Solar", problem: "failed_subscription", problemLabel: "Failed repeat payment", kind: "subscription", who: "Rae Chen", amount: 89, currency: "EUR", ageDays: 2, priority: "low" }),
  ROW({ key: "s5", accountName: "Sample Dental", problem: "late_invoice", problemLabel: "Late invoice", who: "Ivo Petrov", amount: 640, ageDays: 22, status: "contacted" }),
];
const SOURCES: PmSource[] = [
  { key: "plans", label: "Your clients' paid plans", state: "ok", scope: "", lastOkAt: "2026-11-11T08:00:00Z", message: null },
  { key: "transactions", label: "Payments", state: "ok", scope: "payments/transactions.readonly", lastOkAt: "2026-11-11T08:00:00Z", message: null },
  { key: "subscriptions", label: "Repeat payments", state: "needs_permission", scope: "payments/subscriptions.readonly", lastOkAt: null, message: "Needs permission: reconnect" },
  { key: "invoices", label: "Invoices", state: "ok", scope: "invoices.readonly", lastOkAt: "2026-11-11T08:00:00Z", message: null },
];
const TODAY: PmToday = {
  headline: "5 payments need action, across 4 client accounts.", button: { label: "Review them", count: 5 },
  tiles: [
    { key: "failed", label: "Failed payments", count: 2, money: [{ currency: "USD", amount: 1450, count: 1 }, { currency: "EUR", amount: 89, count: 1 }], note: null, filter: { problem: "failed" } },
    { key: "late", label: "Late invoices", count: 2, money: [{ currency: "USD", amount: 3840, count: 2 }], note: null, filter: { problem: "late_invoice" } },
    { key: "past_due_plans", label: "Past due plans", count: 1, money: [{ currency: "USD", amount: 297, count: 1 }], note: "Money your clients owe you for the plan you sell them.", filter: { problem: "past_due_plan" } },
    { key: "disputes", label: "Open payment disputes", count: 1, money: [{ currency: "USD", amount: 480, count: 1 }], note: "Entered by you; not read from your payment processor.", filter: { disputes: true } },
    { key: "refunds", label: "Refunds, last 30 days", count: 3, money: [{ currency: "USD", amount: 210, count: 3 }], note: null, filter: { problem: "refund" } },
  ],
  atRisk: [{ currency: "USD", amount: 5587, count: 4, formula: "Estimate: 1 failed payment + 2 late invoices (amount still due) + 1 past due plan (price per month). Each currency is shown separately and nothing is counted twice." }, { currency: "EUR", amount: 89, count: 1, formula: "Estimate: 1 failed payment. Each currency is shown separately and nothing is counted twice." }],
  recoveredLast30: [{ currency: "USD", amount: 2300, count: 6 }], avgDaysToRecover: 4.5, recoveryRate: 62, historyStarts: "2026-10-20", sources: SOURCES, accounts: 4, testRowsHidden: 0, setupNote: null,
  expectedMonthly: [{ currency: "USD", amount: 2376, count: 8, formula: "Estimate: plan price per month times 8 paying client accounts. The platform does not give billing days." }],
};
const DISPUTES: PmDisputes = {
  label: "Entered by you; not read from your payment processor.", total: 2, open: 1, due: 1,
  rows: [
    { id: "d1", locationId: "loc-s1", accountName: "Sample Dental", customer: "Dana Ortiz", amount: 480, currency: "USD", reason: "Customer says the service was not delivered", openedOn: "2026-11-05", evidenceDueOn: "2026-11-13", status: "open", processorUrl: null, notes: null, daysLeft: 2, alert: "soon", updatedAt: "2026-11-05T00:00:00Z" },
    { id: "d2", locationId: "loc-s2", accountName: "Sample Roofing", customer: "Ken Mills", amount: 900, currency: "USD", reason: null, openedOn: "2026-10-01", evidenceDueOn: "2026-10-12", status: "won", processorUrl: null, notes: "Sent the signed work order", daysLeft: -30, alert: null, updatedAt: "2026-10-14T00:00:00Z" },
  ],
};
const UPCOMING: PmUpcoming = {
  plans: { state: "ok", items: [{ currency: "USD", amount: 2376, count: 8, accounts: 8, formula: "Estimate: plan price per month times paying client accounts. The platform does not give billing days." }], note: "About this much a month from your clients (estimate). The platform does not tell us the day each client is charged." },
  customers: { available: false, note: "Not available from the platform yet: the date of the next repeat payment for your clients' customers." },
  missing: ["Next charge date of a paid plan", "Why a payment failed", "Retrying a card from SubSync", "A link for the customer to update their card", "Payment disputes from your processor"],
};
const HISTORY: PmHistory = {
  historyStarts: "2026-10-20", avgDaysToRecover: 4.5, recoveryRate: 62, flagged: 13, fixed: 8, recovered: [{ currency: "USD", amount: 2300, count: 6 }],
  days: Array.from({ length: 21 }, (_, i) => ({ day: new Date(Date.UTC(2026, 9, 21 + i)).toISOString().slice(0, 10), failed: (i * 7) % 4, recovered: (i * 5) % 3, late: (i * 3) % 3 })),
  repeat: [{ locationId: "loc-s1", accountName: "Sample Dental", who: "Dana Ortiz", count: 3 }],
};
const OPTIONS: PmOptions = { accounts: [{ id: "loc-s1", name: "Sample Dental" }, { id: "loc-s2", name: "Sample Roofing" }], currencies: ["USD", "EUR"], flags: META.flags, roleLevel: "agency", lastSync: "2026-11-11T08:00:00Z" };
const SETUP: PmSetup = { sources: SOURCES, scopes: SOURCES.map((s) => s.scope), checks: [{ key: "live", title: "Live payments found", ok: true, detail: "212 payments, invoices and repeat payments read." }, { key: "plans", title: "Plans you sell to your clients", ok: true, detail: "8 client accounts are on a paid plan from you." }, { key: "words", title: "Status words we do not recognise", ok: true, detail: "Every status word was understood." }] };

export type FxParams = Record<string, string | number | boolean | undefined | null>;
export function sample(part: PmPart, p: FxParams, empty: boolean): object {
  const e = empty;
  switch (part) {
    case "today": return { ...META, ...(e ? { ...TODAY, headline: "No payment needs action right now.", button: null, tiles: TODAY.tiles.map((t) => ({ ...t, count: 0, money: [] })), atRisk: [], recoveredLast30: [], expectedMonthly: [] } : TODAY) };
    case "queue": {
      let rows = ROWS;
      const pr = String(p.problem ?? "");
      if (pr === "failed") rows = rows.filter((r) => r.problem === "failed_payment" || r.problem === "failed_subscription"); else if (pr) rows = rows.filter((r) => r.problem === pr);
      if (pr === "refund") rows = [ROW({ key: "r1", accountName: "Sample Med Spa", problem: "refund", problemLabel: "Refund", kind: "transaction", amount: 70, ageDays: 6, priority: "low", reason: "Money that was paid and then given back to the customer.", next: "Nothing to do unless the refund was a surprise. Open it in your CRM to see why." })];
      if (e) rows = [];
      const out: PmQueue & PmMeta = { ...META, rows, total: rows.length, next: null, totals: rows.length ? [{ currency: "USD", amount: rows.filter((r) => r.currency === "USD").reduce((a, r) => a + (r.amount ?? 0), 0), count: rows.filter((r) => r.currency === "USD").length }] : [], truncated: false };
      return out;
    }
    case "item": return { ...META, row: ROWS[0], events: [{ at: "2026-10-24T10:00:00Z", status: "failed", from: null, amount: 1450, currency: "USD" }], notes: [], messages: [{ tone: "friendly", label: "Friendly", text: "Hi Dana,\nA quick note: your payment of $1,450 did not go through on our side.\nThank you" }, { tone: "neutral", label: "Neutral", text: "Hi Dana,\nOur records show your payment of $1,450 is still open.\nThank you" }, { tone: "firm", label: "Firm but polite", text: "Hi Dana,\nYour payment of $1,450 is now overdue.\nThank you" }], canResend: false, resendNote: "" } satisfies PmItem & PmMeta;
    case "disputes": return { ...META, ...(e ? { ...DISPUTES, rows: [], total: 0, open: 0, due: 0 } : DISPUTES) };
    case "upcoming": return { ...META, ...UPCOMING };
    case "history": return { ...META, ...(e ? { ...HISTORY, days: [], repeat: [], recovered: [], flagged: 0, fixed: 0, avgDaysToRecover: null, recoveryRate: null, historyStarts: null } : HISTORY) };
    case "options": return { ...META, ...OPTIONS };
    case "setup": return { ...META, ...SETUP };
    case "checks": return { ...META, ...(e ? { account: null, sections: [], sample: true, unitsNote: "" } : sampleChecks()) };
    default: return META;
  }
}
