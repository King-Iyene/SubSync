import { appPlanLabel } from "./cl3-money-core.ts";
import { accessState, trialEndingSoon, type AccessState } from "./clients3-installs.ts";
import type { Getter } from "./clients3-saas.ts";

// Plan monitor, pure logic (no database): one row per client account for the SubSync plan, status chip and alert drafts. Unit tested with fixtures (docs/METRICS.md "Plan monitor").
//
// Sources and what is NOT VERIFIED LIVE (docs/FEATURE_STATUS.md):
//  - Installed list GET /oauth/installedLocations (oauth.readonly): live-verified 13 Nov 2026 (install flag, plan id, on-trial flag, no trial end date).
//  - Charges GET /marketplace/billing/charges (charges.readonly, SUB-ACCOUNT token, Version v3, params skip/limit/startDate/endDate): read in the published API docs 14 Nov 2026. NOT VERIFIED LIVE.
//    The platform describes these as charges an app made through its billing meters. SubSync has no meters, so an empty list is expected and is shown as "No charge recorded", never as a failure.
//  - Installer details GET /marketplace/app/{appId}/installations (marketplace-installer-details.readonly): documents one record for the asking token (company, installer, plan id; NO trial, NO dates). NOT CALLED:
//    it adds nothing the installed list does not already give. NOT VERIFIED LIVE.
//  - saas/location.read: the published GET /locations/{id} page (scope locations.readonly) lists no SaaS field, so nothing is read with it. NOT VERIFIED LIVE / no known read.
//  - Pending SaaS payments need saas/company.read, an agency-only permission: SAAS_PENDING_NOTE says so plainly.

export const CHARGES_SCOPE = "charges.readonly";
export const CHARGES_VERSION = "v3";
export const SAAS_PENDING_NOTE = "Pending client payments are not available to this kind of app: the platform gives them only to company-level apps.";

export type PlanChip = "active" | "trial" | "plan_changed" | "payment_problem" | "not_installed" | "unknown";
export type ChargeInfo = { state: "ok" | "none" | "needs_permission" | "not_available" | "not_checked"; lastAt: string | null; amount: number | null; currency: string | null };
export type MonitorInput = {
  locationId: string; name: string; installed: boolean | null; planId: string | null; onTrial: boolean | null; trialEndsAt: string | null;
  charge: ChargeInfo;
  /** A plan change seen in our own record within the last 7 days (ISO time of the change), or null. */
  planChangedAt: string | null;
  /** True only from real failed-payment data we already read (past due on the client plan read, or a failed payment in the payments record). */
  paymentProblem: boolean;
  /** Whether the installed list could be read for this install at all. */
  installsRead: boolean;
};
export type MonitorRow = {
  locationId: string; name: string; planLabel: string | null; trialDaysLeft: number | null; trialNote: string | null;
  installStatus: "installed" | "not_installed" | "unknown"; lastChargeAt: string | null; lastChargeAmount: number | null; lastChargeCurrency: string | null; chargeNote: string | null;
  chip: PlanChip; chipLabel: string;
};

const DAY = 86_400_000;
export const trialDaysLeft = (endsAt: string | null, now: number): number | null => {
  if (!endsAt) return null;
  const t = Date.parse(endsAt);
  return Number.isNaN(t) || t < now ? null : Math.ceil((t - now) / DAY);
};

const CHARGE_NOTES: Record<ChargeInfo["state"], string | null> = {
  ok: null, none: "No charge recorded",
  needs_permission: "Needs permission: reconnect and allow charge access (charges.readonly)",
  not_available: "Not available from the platform yet", not_checked: "Not checked yet",
};

/** Status chip. Order: not installed, payment problem, trial ending, plan changed, trial, active. A trial with no known end shows "On a trial". */
export function monitorRow(i: MonitorInput, now: number): MonitorRow {
  const left = i.onTrial === true ? trialDaysLeft(i.trialEndsAt, now) : null;
  const base = { locationId: i.locationId, name: i.name, planLabel: appPlanLabel(i.planId), trialDaysLeft: left, lastChargeAt: i.charge.lastAt, lastChargeAmount: i.charge.amount, lastChargeCurrency: i.charge.currency, chargeNote: CHARGE_NOTES[i.charge.state] };
  const trialNote = i.onTrial === true ? (left !== null ? `${left} ${left === 1 ? "day" : "days"} left` : "On a trial (end date not given by the platform)") : null;
  const installStatus: MonitorRow["installStatus"] = i.installed === null ? "unknown" : i.installed ? "installed" : "not_installed";
  const mk = (chip: PlanChip, chipLabel: string): MonitorRow => ({ ...base, trialNote, installStatus, chip, chipLabel });
  if (i.installed === false) return mk("not_installed", "Not installed");
  if (i.installed === null) return mk("unknown", i.installsRead ? "Not known" : "Not known: needs permission or not read yet");
  if (i.paymentProblem) return mk("payment_problem", "Payment problem");
  if (i.onTrial === true && left !== null && trialEndingSoon(i.trialEndsAt, now, 3)) return mk("trial", `Trial ends in ${left} ${left === 1 ? "day" : "days"}`);
  if (i.planChangedAt) return mk("plan_changed", "Plan changed");
  if (i.onTrial === true) return mk("trial", left !== null ? `On a trial, ${left} days left` : "On a trial");
  return mk("active", "Active");
}

/** Charges list from GET /marketplace/billing/charges. The newest createdAt wins. A refund line never counts as the last charge. */
export function parseCharges(body: unknown): ChargeInfo {
  const list = body && typeof body === "object" ? (body as Record<string, unknown>).charges : null;
  let best: { at: number; amount: number | null; currency: string | null } | null = null;
  for (const c of Array.isArray(list) ? list : []) {
    if (!c || typeof c !== "object") continue;
    const o = c as Record<string, unknown>;
    if (o.transactionType === "refund" || o.refunded === true) continue;
    const at = typeof o.createdAt === "string" ? Date.parse(o.createdAt) : NaN;
    if (Number.isNaN(at)) continue;
    const amt = typeof o.amountCharged === "number" && Number.isFinite(o.amountCharged) ? o.amountCharged : null;
    if (!best || at > best.at) best = { at, amount: amt, currency: typeof o.currency === "string" ? o.currency.slice(0, 8) : null };
  }
  return best ? { state: "ok", lastAt: new Date(best.at).toISOString(), amount: best.amount, currency: best.currency } : { state: "none", lastAt: null, amount: null, currency: null };
}

/** One account's charges, honest states (never an invented amount). `get` must carry that account's own token. */
export async function readCharges(get: Getter, granted: string[] | null): Promise<ChargeInfo> {
  const r = await get("/marketplace/billing/charges?skip=0&limit=100", CHARGES_VERSION).catch(() => ({ status: 0, body: null as unknown }));
  if (r.status >= 200 && r.status < 300) return parseCharges(r.body);
  const a: AccessState = accessState(r, granted, CHARGES_SCOPE);
  return { state: a === "needs_permission" ? "needs_permission" : "not_available", lastAt: null, amount: null, currency: null };
}

export type MonitorAlert = { locationId: string; kind: string; severity: "info" | "warning" | "critical"; title: string; detail: Record<string, unknown>; dedupeKey: string };
export type RecentChanges = { planChanges: Map<string, { from: string | null; to: string | null; at: string }>; removed: Map<string, string> };
/** Alerts from the rows: trial ending in 3 days, plan changed (kept 7 days), uninstall detected (from our own change record, kept 7 days). Keys start with pm:. */
export function monitorAlerts(rows: MonitorRow[], recent: RecentChanges, now: number): MonitorAlert[] {
  const out: MonitorAlert[] = [];
  for (const r of rows) {
    if (r.installStatus === "installed" && r.trialDaysLeft !== null && r.trialDaysLeft <= 3)
      out.push({ locationId: r.locationId, kind: "plan_trial_ending", severity: "warning", title: `${r.name}: SubSync trial ends in ${r.trialDaysLeft} ${r.trialDaysLeft === 1 ? "day" : "days"}`, detail: { daysLeft: r.trialDaysLeft }, dedupeKey: `pm:trial:${r.locationId}` });
    const pc = recent.planChanges.get(r.locationId);
    if (pc && now - Date.parse(pc.at) <= 7 * DAY)
      out.push({ locationId: r.locationId, kind: "plan_changed", severity: "info", title: `${r.name}: SubSync plan changed`, detail: { from: pc.from, to: pc.to, at: pc.at }, dedupeKey: `pm:plan:${r.locationId}:${pc.at.slice(0, 10)}` });
    const rm = recent.removed.get(r.locationId);
    if (rm && r.installStatus === "not_installed" && now - Date.parse(rm) <= 7 * DAY)
      out.push({ locationId: r.locationId, kind: "plan_uninstalled", severity: "warning", title: `${r.name}: SubSync was removed`, detail: { at: rm }, dedupeKey: `pm:removed:${r.locationId}:${rm.slice(0, 10)}` });
  }
  return out;
}

/** Plan observation to record when the plan id on the installed list differs from the last one stored. Null when nothing to record (first sight, unchanged). */
export function planObservation(before: string | null | undefined, after: string | null): { from: string | null; to: string | null } | null {
  if (before === undefined || before === after) return null;
  return { from: appPlanLabel(before) ?? before, to: appPlanLabel(after) ?? after };
}
