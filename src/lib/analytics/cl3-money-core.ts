import type { Cl2Row } from "./clients2-types";
import type { Cl3Bucket, Cl3MoneyRow } from "./clients3-types";
import { planName } from "../entitlements-core.ts";
import { installLine, trialEndingSoon } from "./clients3-installs.ts";

// Pure logic for Clients money (no database): filter buckets, one table row, the one-sentence line for today, history wording. Unit tested.

export type InstallExtra = { installed: boolean; version: string | null; installedAt?: string | null; planId?: string | null; onTrial?: boolean | null; trialEndsAt?: string | null };
export type MoneyExtras = { wallet: Map<string, { balance: number | null; state: string | null }>; installs: Map<string, InstallExtra> };

/** Plain name of the app plan from its id. Unknown ids are shown as such, never guessed. */
export function appPlanLabel(planId: string | null | undefined): string | null {
  if (!planId) return null;
  const n = planName(planId);
  return n === "growth" ? "Growth plan" : n === "legacy" ? "Earlier test plan" : "Other plan";
}

/** Which bucket filters a row belongs to. A row can be in several (for example unpaid and failing). */
export function bucketsOf(r: Pick<Cl3MoneyRow, "plan" | "wallet" | "subsync"> & { install?: Cl3MoneyRow["install"] }): Cl3Bucket[] {
  const b: Cl3Bucket[] = ["all"];
  if (/^trial(ing)?$/i.test(r.plan.statusRaw ?? "")) b.push("trial");
  if (r.install?.onTrial === true) b.push("app_trial");
  if (["past_due", "cancelled", "paused", "other"].includes(r.plan.pay)) b.push("unpaid");
  if (r.plan.pay === "past_due") b.push("failing");
  if (r.plan.pay === "none") b.push("no_plan");
  if (r.plan.pay === "paid") b.push("paid");
  if (r.wallet.balance !== null && r.wallet.balance <= 0) b.push("empty_wallet");
  if (r.subsync === "missing") b.push("app_missing");
  return b;
}

export function moneyRow(r: Cl2Row, x: MoneyExtras, now = Date.now()): Cl3MoneyRow {
  const w = x.wallet.get(r.locationId), i = x.installs.get(r.locationId);
  const install: Cl3MoneyRow["install"] = i ? (() => {
    const planLabel = appPlanLabel(i.planId), onTrial = i.onTrial ?? null, trialEndsAt = i.trialEndsAt ?? null;
    return { installedAt: i.installedAt ?? null, versionId: i.version, planLabel, onTrial, trialEndsAt, endingSoon: onTrial === true && trialEndingSoon(trialEndsAt, now), line: installLine({ installed: i.installed, versionId: i.version, installedAt: i.installedAt ?? null, planLabel, onTrial, trialEndsAt }) };
  })() : null;
  const p = r.plan;
  return {
    locationId: r.locationId, name: r.name, email: r.email,
    plan: { name: p.name, pay: p.pay, payLabel: p.payLabel, statusRaw: p.statusRaw, monthly: p.monthly, currency: p.currency, interval: p.interval, daysInStatus: p.daysInStatus, since: p.since, state: p.state, explain: p.explain },
    level: r.level, summary: r.summary,
    wallet: { balance: w?.balance ?? null, state: w?.state ?? null },
    subsync: i ? (i.installed ? "installed" : "missing") : "unknown", install,
    nextChargeAt: null, failureReason: null, url: r.url,
  };
}

const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
const cash = (cur: string, n: number) => `${cur === "USD" ? "$" : `${cur} `}${Math.round(n).toLocaleString("en-US")}`;

/** The one-sentence "what to do today" for money. Plain words, always from the counts. */
export function todayLine(c: Record<Cl3Bucket, number>, atRisk: Array<{ currency: string; monthly: number }>, read: "ok" | "needs_permission" | "not_available" | "not_checked" = "ok"): { headline: string; bucket: Cl3Bucket | null } {
  const risk = atRisk[0] && atRisk[0].monthly > 0 ? ` (about ${cash(atRisk[0].currency, atRisk[0].monthly)} a month at the plan price)` : "";
  if (c.failing > 0) return { headline: `${plural(c.failing, "client has", "clients have")} a payment that did not go through${risk}. Ask them to update their card.`, bucket: "failing" };
  if (c.unpaid > 0) return { headline: `${plural(c.unpaid, "client plan is", "client plans are")} cancelled, paused or in a state to check${risk}.`, bucket: "unpaid" };
  if (c.app_missing > 0) return { headline: `SubSync is missing on ${plural(c.app_missing, "client account", "client accounts")}. Install it from your CRM's app screen.`, bucket: "app_missing" };
  if (c.empty_wallet > 0) return { headline: `${plural(c.empty_wallet, "client account has", "client accounts have")} an empty credit balance, so texts and calls may stop.`, bucket: "empty_wallet" };
  if (c.no_plan > 0) return { headline: `${plural(c.no_plan, "client account is", "client accounts are")} not on a paid plan from you.`, bucket: "no_plan" };
  // Never reassure when the data could not be read.
  if (read === "needs_permission") return { headline: "Not known: needs permission. SubSync cannot read the client plans yet, so it cannot say who is paid up. Reconnect and allow plan access.", bucket: null };
  if (read === "not_available") return { headline: "Not known: the platform does not give client plan details to this app for these accounts, so SubSync cannot say who is paid up. Check billing in your CRM.", bucket: null };
  if (read === "not_checked") return { headline: "Not known yet: the plans have not been read. The next hourly read fills this in.", bucket: null };
  return { headline: "Every client plan SubSync could read is paid up. Nothing to chase today.", bucket: null };
}

const word = (v: string | null) => (v ? v.replace(/_/g, " ") : "nothing");
export function historyText(kind: string, from: string | null, to: string | null): string {
  switch (kind) {
    case "status": return `Payment status changed from ${word(from)} to ${word(to)}.`;
    case "plan": return `Plan changed from ${from ?? "none"} to ${to ?? "none"}.`;
    case "wallet_low": return "Credit balance ran out.";
    case "app_installed": return "SubSync was installed.";
    case "app_removed": return "SubSync was removed.";
    default: return "Changed.";
  }
}

/** Whether the plan list could be read, from the state of every account row: any readable row wins, then a permission refusal, then "not available", else never read. */
export function planReadOf(states: string[]): "ok" | "needs_permission" | "not_available" | "not_checked" {
  if (states.some((s) => s === "ok" || s === "no_plan")) return "ok";
  if (states.some((s) => s === "needs_permission")) return "needs_permission";
  if (states.some((s) => s === "not_available")) return "not_available";
  return "not_checked";
}

/** The counts line for Plans and payments: only counts the platform data supports. Payments due soon are never counted (the platform gives no next payment date). */
export function plansCountsLine(c: Record<Cl3Bucket, number>): string {
  return `${c.failing.toLocaleString("en-US")} past due, ${Math.max(0, c.unpaid - c.failing).toLocaleString("en-US")} cancelled, paused or to check, ${c.trial.toLocaleString("en-US")} on a trial`;
}

