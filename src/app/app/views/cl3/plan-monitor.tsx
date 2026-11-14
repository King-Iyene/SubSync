"use client";

import type { Cl3PlanMonitor } from "@/lib/analytics/plan-monitor";
import { Load } from "./shared";
import { useCl } from "./data";

// Clients, Plan monitor: one table, a row per client account, for the SubSync plan. Real data only: a value the platform did not give shows its reason, never a guess.
const CHIP: Record<string, string> = { active: "ok", trial: "watch", plan_changed: "watch", payment_problem: "act", not_installed: "act", unknown: "unknown" };
const day = (iso: string | null) => (iso ? iso.slice(0, 10) : null);
const cash = (c: string | null, n: number) => `${!c || c === "USD" ? "$" : `${c} `}${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

export function PlanMonitor({ onPayments }: { onPayments: (id?: string) => void }) {
  const r = useCl<Cl3PlanMonitor>("plan-monitor", {});
  return (
    <section className="cl-drill" aria-label="Plan monitor" data-testid="cl3-plan-monitor">
      <h3 className="mb-1 text-base font-semibold">Plan monitor</h3>
      <Load r={r} empty={(m) => m.total === 0 && "Client accounts appear here after the first sync finishes."}>
        {(m) => (
          <>
            <p className="cl-sentence" data-testid="cl3-pm-counts">
              {m.counts.paymentProblem} payment {m.counts.paymentProblem === 1 ? "problem" : "problems"}, {m.counts.trialEnding} {m.counts.trialEnding === 1 ? "trial" : "trials"} ending within 3 days, {m.counts.planChanged} plan {m.counts.planChanged === 1 ? "change" : "changes"} this week, {m.counts.notInstalled} not installed.
            </p>
            <div className="cl-table-wrap"><table className="ap-table" data-testid="cl3-pm-table">
              <thead><tr><th>Client account</th><th>SubSync plan</th><th>Trial</th><th>Install</th><th>Last charge</th><th>Status</th><th /></tr></thead>
              <tbody>{m.rows.map((x) => (
                <tr key={x.locationId} data-testid="cl3-pm-row">
                  <td><span className="ap-name">{x.name}</span></td>
                  <td>{x.planLabel ?? "Plan not known"}</td>
                  <td>{x.trialNote ?? ""}</td>
                  <td>{x.installStatus === "installed" ? "Installed" : x.installStatus === "not_installed" ? "Not installed" : "Not known"}</td>
                  <td title={x.chargeNote ?? undefined}>{x.lastChargeAt ? `${day(x.lastChargeAt)}${x.lastChargeAmount !== null ? `, ${cash(x.lastChargeCurrency, x.lastChargeAmount)}` : ""}` : x.chargeNote ?? ""}</td>
                  <td><span className="cl-chip" data-level={CHIP[x.chip] ?? "unknown"}>{x.chipLabel}</span></td>
                  <td className="text-right">{x.chip === "payment_problem" && <button type="button" className="ap-link" onClick={() => onPayments(x.locationId)}>Payments</button>}</td>
                </tr>
              ))}</tbody>
            </table></div>
            <p className="ap-fine" data-testid="cl3-pm-note">{m.pendingNote} Trial end dates and last charges show only when the platform gives them.{m.historyStarts ? ` Plan changes are recorded from ${m.historyStarts}.` : ""}</p>
          </>
        )}
      </Load>
    </section>
  );
}
