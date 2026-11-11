import { fmtMoney } from "./payments-format.ts";
import type { PmAgeBucket, PmKind, PmMoney, PmProblem } from "./payments-types.ts";

// Payments: the pure rules (no database, no network), written down in docs/METRICS.md and unit-tested. Everything the sweep and the screens decide comes from here.
// Money is never added across currencies. Test-mode rows are dropped before anything is counted. Status words the platform does not document are kept raw and shown as "other".

const str = (v: unknown, max = 200): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const num = (v: unknown): number | null => { const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN; return Number.isFinite(n) ? n : null; };
const dig = (o: unknown, ...keys: string[]): unknown => { let c = o; for (const k of keys) { if (c && typeof c === "object") c = (c as Record<string, unknown>)[k]; else return undefined; } return c; };
const DAY = 86_400_000;

export type Mapped = "failed" | "paid" | "refunded" | "pending" | "open" | "late" | "draft" | "void" | "active" | "past_due" | "cancelled" | "paused" | "other";

/** The platform does not document transaction and subscription status words (only "succeeded" and "active" appear in examples), so unknown words map to "other" and are logged by the caller. */
export function mapStatus(kind: PmKind, raw: string | null): Mapped {
  const s = (raw ?? "").toLowerCase().trim().replace(/[\s-]+/g, "_");
  if (!s) return "other";
  if (kind === "transaction") {
    if (/^(failed|failure|declined|error|errored|card_declined|requires_payment_method|canceled|cancelled)$/.test(s)) return "failed";
    if (/^(succeeded|success|paid|completed|complete|captured)$/.test(s)) return "paid";
    if (/^(refunded|partially_refunded|refund)$/.test(s)) return "refunded";
    if (/^(pending|processing|requires_action|requires_confirmation|in_progress)$/.test(s)) return "pending";
    return "other";
  }
  if (kind === "invoice") {
    if (s === "paid") return "paid";
    if (s === "sent" || s === "partially_paid" || s === "payment_processing") return "open";
    if (s === "draft") return "draft";
    if (s === "void") return "void";
    return "other";
  }
  // subscriptions and client paid plans
  if (/^(active|trialing|trial|paid|current)$/.test(s)) return "active";
  if (/^(past_due|unpaid|incomplete|failed|payment_failed|overdue)$/.test(s)) return "past_due";
  if (/^(canceled|cancelled|incomplete_expired|expired|ended|terminated)$/.test(s)) return "cancelled";
  if (/^(paused)$/.test(s)) return "paused";
  return "other";
}

/** Today's date (YYYY-MM-DD) on the account's own clock. A bad time zone falls back to UTC. */
export function todayIn(tz: string | null | undefined, now: number): string {
  try { return new Intl.DateTimeFormat("en-CA", { timeZone: tz || "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now)); } catch { return new Date(now).toISOString().slice(0, 10); }
}

/** An invoice is late when it is open (sent or partly paid) and its due date is before today on the account's clock. The platform has no "overdue" status: this is derived. */
export function isLateInvoice(rawStatus: string | null, dueDate: string | null, today: string): boolean {
  if (!dueDate || !/^\d{4}-\d{2}-\d{2}/.test(dueDate)) return false;
  const s = (rawStatus ?? "").toLowerCase();
  return (s === "sent" || s === "partially_paid") && dueDate.slice(0, 10) < today;
}

export type Normal = {
  kind: PmKind; itemId: string; statusRaw: string | null; mapped: Mapped; amount: number | null; amountRefunded: number | null; currency: string | null; dueDate: string | null;
  contactId: string | null; contactName: string | null; contactEmail: string | null; sourceName: string | null; liveMode: boolean; occurredAt: string | null;
};

export function normalTransaction(r: unknown): Normal | null {
  const id = str(dig(r, "_id")); if (!id) return null;
  const raw = str(dig(r, "status"));
  return { kind: "transaction", itemId: id, statusRaw: raw, mapped: mapStatus("transaction", raw), amount: num(dig(r, "amount")), amountRefunded: num(dig(r, "amountRefunded")), currency: str(dig(r, "currency"), 8)?.toUpperCase() ?? null, dueDate: null,
    contactId: str(dig(r, "contactId"), 64), contactName: str(dig(r, "contactName")), contactEmail: str(dig(r, "contactEmail")), sourceName: str(dig(r, "entitySourceName")), liveMode: dig(r, "liveMode") !== false, occurredAt: str(dig(r, "createdAt"), 40) };
}
export function normalSubscription(r: unknown): Normal | null {
  const id = str(dig(r, "_id")) ?? str(dig(r, "id")); if (!id) return null;
  const raw = str(dig(r, "status"));
  return { kind: "subscription", itemId: id, statusRaw: raw, mapped: mapStatus("subscription", raw), amount: num(dig(r, "amount")), amountRefunded: null, currency: str(dig(r, "currency"), 8)?.toUpperCase() ?? null, dueDate: null,
    contactId: str(dig(r, "contactId"), 64), contactName: str(dig(r, "contactName")), contactEmail: str(dig(r, "contactEmail")), sourceName: str(dig(r, "entitySourceName")), liveMode: dig(r, "liveMode") !== false, occurredAt: str(dig(r, "updatedAt"), 40) ?? str(dig(r, "createdAt"), 40) };
}
export function normalInvoice(r: unknown): Normal | null {
  const id = str(dig(r, "_id")); if (!id) return null;
  const raw = str(dig(r, "status"));
  return { kind: "invoice", itemId: id, statusRaw: raw, mapped: mapStatus("invoice", raw), amount: num(dig(r, "amountDue")), amountRefunded: null, currency: str(dig(r, "currency"), 8)?.toUpperCase() ?? null, dueDate: str(dig(r, "dueDate"), 10),
    contactId: str(dig(r, "contactDetails", "id"), 64), contactName: str(dig(r, "contactDetails", "name")), contactEmail: str(dig(r, "contactDetails", "email")), sourceName: str(dig(r, "name")) ?? str(dig(r, "title")), liveMode: dig(r, "liveMode") !== false, occurredAt: str(dig(r, "createdAt"), 40) ?? str(dig(r, "issueDate"), 10) };
}

/** What needs action, or null. Plans come from the paid-plan list (status past due). */
export function problemOf(n: Pick<Normal, "kind" | "mapped" | "statusRaw" | "dueDate">, today: string): PmProblem | null {
  if (n.kind === "transaction") return n.mapped === "failed" ? "failed_payment" : null;
  if (n.kind === "invoice") return isLateInvoice(n.statusRaw, n.dueDate, today) ? "late_invoice" : null;
  if (n.kind === "subscription") return n.mapped === "past_due" ? "failed_subscription" : null;
  return n.mapped === "past_due" ? "past_due_plan" : null;
}

export function ageDays(since: string | number | Date | null, now: number): number {
  if (since === null) return 0;
  const t = new Date(since).getTime();
  return Number.isFinite(t) ? Math.max(0, Math.floor((now - t) / DAY)) : 0;
}
export function ageBucket(days: number): PmAgeBucket { return days <= 3 ? "0-3" : days <= 7 ? "4-7" : days <= 14 ? "8-14" : days <= 30 ? "15-30" : "31+"; }
const WEIGHT: Record<PmAgeBucket, number> = { "0-3": 1, "4-7": 1.5, "8-14": 2, "15-30": 3, "31+": 4 };
/** Ranking: amount times an age weight. Used only to sort; totals are always per currency. An item with no amount sorts by age alone. */
export function rankScore(amount: number | null, days: number): number { return Math.round(((amount && amount > 0 ? amount : 1) * WEIGHT[ageBucket(days)]) * 100) / 100; }
export function priorityOf(rank: number, days: number): "high" | "medium" | "low" { return days > 14 || rank >= 1000 ? "high" : days > 3 || rank >= 200 ? "medium" : "low"; }

/** Plain words for why, from the problem and the platform's own status word (never invented). */
export function reasonWords(p: PmProblem, statusRaw: string | null): string {
  if (p === "refund") return "Money that was paid and then given back to the customer.";
  const raw = statusRaw ? ` (the platform says "${statusRaw}")` : "";
  if (p === "failed_payment") return `The card or bank did not accept this payment${raw}. The platform does not tell us the exact reason.`;
  if (p === "late_invoice") return "The invoice was sent, its due date has passed and it is not fully paid.";
  if (p === "failed_subscription") return `A repeat payment did not go through${raw}. The platform does not tell us the exact reason.`;
  return `This client's payment for the plan you sell them is past due${raw}. The platform does not tell us the exact reason.`;
}
export function nextStepWords(p: PmProblem): string {
  if (p === "refund") return "Nothing to do unless the refund was a surprise. Open it in your CRM to see why.";
  if (p === "failed_payment" || p === "failed_subscription") return "Ask the customer to update their card or pay another way, then check it in your CRM.";
  if (p === "late_invoice") return "Send a friendly reminder with the invoice link, or call them.";
  return "Check the card in your payment dashboard, ask your client to update it, and we will show it when it is paid.";
}

export function totalsByCurrency(rows: ReadonlyArray<{ amount: number | null; currency: string | null }>): PmMoney[] {
  const m = new Map<string, PmMoney>();
  for (const r of rows) {
    const c = r.currency ?? "";
    const e = m.get(c) ?? { currency: c, amount: 0, count: 0 };
    e.count++; if (r.amount && r.amount > 0) e.amount = Math.round((e.amount + r.amount) * 100) / 100;
    m.set(c, e);
  }
  return [...m.values()].sort((a, b) => b.amount - a.amount || a.currency.localeCompare(b.currency));
}

export { fmtMoney };

/** The price of a paid plan per month, from its price and billing interval. Weekly and yearly are converted; anything else returns null (not guessed). */
export function monthlyOf(amount: number | null, interval: string | null): number | null {
  if (amount === null || amount < 0) return null;
  const i = (interval ?? "month").toLowerCase();
  if (/^(month|monthly)$/.test(i)) return amount;
  if (/^(year|yearly|annual|annually)$/.test(i)) return Math.round((amount / 12) * 100) / 100;
  if (/^(week|weekly)$/.test(i)) return Math.round(((amount * 52) / 12) * 100) / 100;
  return null;
}

/** Revenue at risk, per currency, with the formula in words. Transactions count failed money; invoices count what is owed; a payment and its invoice are never added together. */
export function riskFormula(parts: { failed: number; late: number; plans: number }): string {
  const bits = [parts.failed ? `${parts.failed} failed payment${parts.failed === 1 ? "" : "s"}` : "", parts.late ? `${parts.late} late invoice${parts.late === 1 ? "" : "s"} (amount still due)` : "", parts.plans ? `${parts.plans} past due plan${parts.plans === 1 ? "" : "s"} (price per month)` : ""].filter(Boolean);
  return `Estimate: ${bits.join(" + ") || "nothing open"}. Each currency is shown separately and nothing is counted twice.`;
}

// Disputes (a log the user keeps: the platform has no dispute data).
export function daysUntil(due: string | null, today: string): number | null {
  if (!due || !/^\d{4}-\d{2}-\d{2}/.test(due)) return null;
  return Math.round((Date.parse(due.slice(0, 10) + "T00:00:00Z") - Date.parse(today + "T00:00:00Z")) / DAY);
}
export function disputeAlert(status: string, daysLeft: number | null): "overdue" | "today" | "tomorrow" | "soon" | null {
  if (daysLeft === null || status === "won" || status === "lost" || status === "evidence_sent") return null;
  return daysLeft < 0 ? "overdue" : daysLeft === 0 ? "today" : daysLeft === 1 ? "tomorrow" : daysLeft <= 3 ? "soon" : null;
}

export type Stage = "three_days" | "one_day" | "today" | "overdue";
/** Which reminder an open dispute is due for (3 days, 1 day, the day, then each day overdue), or null. Finished ones are quiet. */
export function stageFor(status: string, daysLeft: number | null): Stage | null {
  if (status !== "open" || daysLeft === null) return null;
  return daysLeft < 0 ? "overdue" : daysLeft === 0 ? "today" : daysLeft === 1 ? "one_day" : daysLeft === 3 ? "three_days" : null;
}

// Reminder text the person copies. SubSync sends nothing. Plain, no threat.
export type Tone = "friendly" | "neutral" | "firm";
export function reminderTexts(v: { name: string | null; amount: number | null; currency: string | null; what: "payment" | "invoice" | "plan"; business: string | null }): Array<{ tone: Tone; label: string; text: string }> {
  const hi = v.name ? `Hi ${v.name.split(/\s+/)[0]},` : "Hi,";
  const amt = v.amount !== null ? ` of ${fmtMoney(v.amount, v.currency)}` : "";
  const thing = v.what === "invoice" ? `your invoice${amt}` : v.what === "plan" ? `your monthly payment${amt}` : `your payment${amt}`;
  const sign = v.business ? `\nThank you,\n${v.business}` : "\nThank you";
  return [
    { tone: "friendly", label: "Friendly", text: `${hi}\nA quick note: ${thing} did not go through on our side. It happens, a card can expire or a bank can hold a payment. Could you have a look when you get a moment? Reply here if you would like us to help.${sign}` },
    { tone: "neutral", label: "Neutral", text: `${hi}\nOur records show ${thing} is still open. Please update your card or pay using the link you were sent, and let us know once it is done.${sign}` },
    { tone: "firm", label: "Firm but polite", text: `${hi}\n${thing[0].toUpperCase()}${thing.slice(1)} is now overdue. Please settle it as soon as you can, or tell us today if something is wrong so we can sort it out together.${sign}` },
  ];
}

/** Recovery stats from flagged items: average days from first problem to resolved, and how many of the flagged ones were fixed. */
export function recoveryStats(items: ReadonlyArray<{ since: number; resolved: number | null }>): { avgDays: number | null; rate: number | null; flagged: number; fixed: number } {
  const fixed = items.filter((i) => i.resolved !== null);
  const avg = fixed.length ? Math.round((fixed.reduce((a, i) => a + ((i.resolved as number) - i.since), 0) / fixed.length / DAY) * 10) / 10 : null;
  return { avgDays: avg, rate: items.length ? Math.round((fixed.length / items.length) * 100) : null, flagged: items.length, fixed: fixed.length };
}

/** The one sentence at the top of Today. */
export function headlineWords(n: { needAction: number; accountsWithProblems: number }): string {
  if (n.needAction === 0) return "No payment needs action right now.";
  return `${n.needAction} payment${n.needAction === 1 ? " needs" : "s need"} action${n.accountsWithProblems > 1 ? `, across ${n.accountsWithProblems} client accounts` : ""}.`;
}

/** A spreadsheet cell that starts with = + - or @ can run as a formula when opened. Prefix it so it is plain text. */
export function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Keyset cursor for the queue: the last row's rank, account, kind and id, so the next page starts right after it. */
export type Cursor = { r: number; l: string; k: string; i: string };
export function encodeCursor(c: Cursor): string { return Buffer.from(JSON.stringify(c)).toString("base64url"); }
export function decodeCursor(s: string | null): Cursor | null {
  if (!s || s.length > 400) return null;
  try { const o = JSON.parse(Buffer.from(s, "base64url").toString("utf8")) as Cursor; return typeof o.r === "number" && Number.isFinite(o.r) && typeof o.l === "string" && typeof o.k === "string" && typeof o.i === "string" ? { r: o.r, l: o.l.slice(0, 128), k: o.k.slice(0, 20), i: o.i.slice(0, 128) } : null; } catch { return null; }
}

/** Read a client paid plan's price from the platform's plan answer. The documented fields are not fully known (CHECK on a live agency), so several likely shapes are tried; null means "not available", never a guess. */
export function planPrice(body: unknown): { amount: number | null; currency: string | null; interval: string | null } {
  const cands: unknown[] = [];
  for (const k of ["pricing", "prices", "pricingPlans", "plans"]) { const a = dig(body, k); if (Array.isArray(a)) cands.push(...a); }
  cands.push(body, dig(body, "plan"), dig(body, "price"));
  for (const c of cands) {
    const amount = num(dig(c, "amount")) ?? num(dig(c, "price")) ?? num(dig(c, "unitAmount"));
    if (amount !== null) return { amount, currency: (str(dig(c, "currency")) ?? "").toUpperCase() || null, interval: str(dig(c, "billingInterval")) ?? str(dig(c, "interval")) ?? str(dig(c, "recurringInterval")) ?? "month" };
  }
  return { amount: null, currency: null, interval: null };
}

