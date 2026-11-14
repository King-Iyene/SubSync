"use client";

import { useEffect, useMemo, useState } from "react";
import type { Cl3Bucket, Cl3HistoryList, Cl3Money, Cl3MoneyRow } from "@/lib/analytics/clients3-types";
import { useData } from "../../session";
import { EmptyState, OpenLeadButton } from "../../ds";
import { Find, LevelChip, Load, NOT_FROM_PLATFORM } from "./shared";
import { useCl, type ClParams } from "./data";
import { PlanMonitor } from "./plan-monitor";
import { scopeList } from "@/lib/scope-words";

// Clients, Money: every client account with its plan, payment status, credit balance and whether SubSync is installed. Real data only. Sample rows appear ONLY with ?cl3fx in the address and say
// "Sample data". Each count opens exactly its rows. Nothing here changes a plan, charges anyone or installs anything: where the platform has no way to do that, a link opens the platform screen.
type Props = { onOpen: (id: string) => void; onPayments: (id?: string) => void; showApps: boolean; showHistory: boolean };

const FILTERS: Array<[Cl3Bucket, string, string]> = [
  ["all", "All accounts", "Every client account."], ["unpaid", "Not paid", "Past due, cancelled, paused, or a status to check."], ["failing", "Payment failing", "The platform reports the plan as past due or unpaid."],
  ["no_plan", "No plan", "Not on a paid plan from you."], ["paid", "Paid up", "Plan is active."], ["empty_wallet", "Empty credit balance", "Texts and calls can stop at zero."], ["app_missing", "SubSync missing", "SubSync is not installed on this account."],
  ["trial", "On a trial", "The platform reports the plan as trialing."], ["app_trial", "SubSync on a trial", "The platform reports SubSync on this account as on its free trial."],
];
const cash = (c: string | null, n: number) => `${!c || c === "USD" ? "$" : `${c} `}${Math.round(n).toLocaleString("en-US")}`;
export const cl3fxOn = () => { try { return typeof window !== "undefined" && /[?&]cl3fx\b/.test(window.location.search + window.location.hash); } catch { return false; } };

function sampleMoney(): Cl3Money {
  const mk = (i: number, pay: string, label: string, name: string, monthly: number | null, bal: number | null, sub: Cl3MoneyRow["subsync"]): Cl3MoneyRow => ({
    locationId: `sample${i}`, name, email: null, plan: { name: monthly ? "Growth plan" : null, pay, payLabel: label, statusRaw: pay, monthly, currency: "USD", interval: "month", daysInStatus: pay === "past_due" ? 9 : 40, since: null, state: "ok", explain: "Sample data." },
    level: i % 2 ? "ok" : "watch", summary: null, wallet: { balance: bal, state: bal === null ? null : "ok" }, subsync: sub, install: sub === "installed" ? { installedAt: "2026-10-30T00:00:00.000Z", versionId: null, planLabel: "Growth plan", onTrial: i === 2, trialEndsAt: null, endingSoon: false, line: "Installed, 2026-10-30, Growth plan" } : null, nextChargeAt: null, failureReason: null, url: null,
  });
  const rows = [mk(1, "past_due", "Past due", "Sample Roofing Co", 297, 12, "installed"), mk(2, "paid", "Paid up", "Sample Dental", 297, 40, "installed"), mk(3, "none", "Not on a paid plan from you", "Sample Realty", null, 0, "missing")];
  return { rows, total: 3, next: null, size: 20, summary: { accounts: 3, counts: { all: 3, unpaid: 1, failing: 1, no_plan: 1, paid: 1, empty_wallet: 1, app_missing: 1, trial: 0, app_trial: 1 }, expectedMonthly: [{ currency: "USD", monthly: 297, accounts: 1 }], atRisk: [{ currency: "USD", monthly: 297, accounts: 1 }], plans: [{ key: "Growth plan", label: "Growth plan", count: 2 }], apps: { state: "ok", installed: 2, missing: 1, unknown: 0, onTrial: 1, endingSoon: 0 }, planRead: "ok", needsPermission: [], today: { headline: "1 client has a payment that did not go through (about $297 a month at the plan price). Ask them to update their card.", bucket: "failing" }, historyStarts: null } };
}

export function MoneyTab({ onOpen, onPayments, showApps, showHistory }: Props) {
  const sample = cl3fxOn();
  const [bucket, setBucket] = useState<Cl3Bucket>("all"), [plan, setPlan] = useState(""), [q, setQ] = useState(""), [dq, setDq] = useState(""), [stack, setStack] = useState<string[]>([]);
  useEffect(() => { const t = setTimeout(() => { setDq(q); setStack([]); }, 300); return () => clearTimeout(t); }, [q]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setStack([]); }, [bucket, plan]);
  const cursor = stack[stack.length - 1];
  const params = useMemo<ClParams>(() => ({ bucket, plan: plan || undefined, q: dq || undefined, cursor: cursor || undefined, size: 20 }), [bucket, plan, dq, cursor]);
  const live = useCl<Cl3Money>("money", params, sample);
  const r = sample ? { data: sampleMoney() as never, error: null, loading: false, reload: () => undefined } : live;
  return (
    <div data-testid="cl3-money" className="cl-stack">
      {sample && <p className="ap-fine" role="status" data-testid="cl3-sample">Sample data: these are not your real clients.</p>}
      <Load r={r} empty={(m) => m.summary.accounts === 0 && "Client accounts appear here after the first sync finishes."}>
        {(m) => {
          const s = m.summary, perm = s.needsPermission;
          // The agency home of the same (possibly white-label) CRM host as the account links; never a hard-coded host.
          const home = (() => { try { const u = m.rows.find((x) => x.url)?.url; return u ? `${new URL(u).origin}/` : null; } catch { return null; } })();
          return (
            <>
              <section className="cl-today" aria-label="What to do today about money">
                <h2 className="cl-h">What to do today</h2>
                <p className="cl-sentence" data-testid="cl3-today">{s.today.headline}</p>
                {s.today.bucket && <button type="button" className="s6-btn" data-kind="primary" onClick={() => setBucket(s.today.bucket as Cl3Bucket)}>Show these {s.counts[s.today.bucket].toLocaleString("en-US")}</button>}
              </section>
              {perm.length > 0 && <p className="ap-fine" role="status" data-testid="cl3-needs-permission">Needs permission: reconnect to let SubSync {scopeList(perm)}. Until then the matching columns stay empty.</p>}
              <section className="cl-drill" aria-label="Plans and payments" data-testid="cl3-plans">
                <h3 className="mb-1 text-base font-semibold">Plans and payments</h3>
                {s.planRead === "ok" ? (
                  <p className="cl-sentence" data-testid="cl3-plans-counts">
                    <button type="button" className="ap-link" onClick={() => setBucket("failing")} data-testid="cl3-plans-failing">{s.counts.failing.toLocaleString("en-US")} past due</button>{", "}
                    <button type="button" className="ap-link" onClick={() => setBucket("unpaid")}>{Math.max(0, s.counts.unpaid - s.counts.failing).toLocaleString("en-US")} cancelled, paused or to check</button>{", "}
                    <button type="button" className="ap-link" onClick={() => setBucket("trial")} data-testid="cl3-plans-trial">{s.counts.trial.toLocaleString("en-US")} on a trial</button>.
                  </p>
                ) : s.planRead === "needs_permission" ? <p className="cl-sentence" data-testid="cl3-plans-state">Needs permission: reconnect and allow SubSync to {scopeList(["saas/company.read"])}. Until then SubSync cannot say who is past due.</p>
                  : s.planRead === "not_available" ? <p className="cl-sentence" data-testid="cl3-plans-state">Not available from the platform for these accounts: it does not give plan details to this kind of app. Check billing in your CRM.</p>
                  : <p className="cl-sentence" data-testid="cl3-plans-state">Not read yet. The next hourly read fills this in.</p>}
                <p className="ap-fine">Source: from your platform billing (the plan list). Payments due in the next 7 days and the next payment date: {NOT_FROM_PLATFORM}, so they are not counted or guessed. Defaulters are listed first below.</p>
              </section>
              {!sample && <PlanMonitor onPayments={onPayments} />}
              <div className="cl-tiles" aria-label="Money headline">
                <div className="cl-tile" style={{ cursor: "default" }} title="Estimate: the plan price per month of every paid-up account. A yearly price is divided by 12. It is the price, not what was charged."><b>{s.expectedMonthly.length ? s.expectedMonthly.map((e) => cash(e.currency, e.monthly)).join(" + ") : "Not enough data"}</b><span>Expected each month (estimate)</span></div>
                <button type="button" className="cl-tile" onClick={() => setBucket("unpaid")} title="Estimate: the monthly plan price of accounts that are not paid up."><b>{s.atRisk.length ? s.atRisk.map((e) => cash(e.currency, e.monthly)).join(" + ") : "$0"}</b><span>At risk each month (estimate)</span></button>
                <button type="button" className="cl-tile" onClick={() => setBucket("unpaid")}><b>{s.counts.unpaid.toLocaleString("en-US")}</b><span>Who owes the plan fee</span></button>
                {showApps && <button type="button" className="cl-tile" onClick={() => setBucket("app_missing")}><b>{s.counts.app_missing.toLocaleString("en-US")}</b><span>Missing SubSync</span></button>}
              </div>
              <p className="ap-fine">Estimates use the plan price (a yearly price divided by 12), never summed across currencies. Next charge date and the reason a payment failed: {NOT_FROM_PLATFORM}. {s.historyStarts ? `Our own record of changes starts ${s.historyStarts}.` : "Our own record of changes starts with the first change we see."}</p>
              <div role="group" aria-label="Filter accounts" className="cl3-chips">
                {FILTERS.filter(([k]) => k !== "app_missing" || showApps).map(([k, label, tip]) => <button key={k} type="button" className="cl-reason" aria-pressed={bucket === k} data-on={bucket === k ? "1" : undefined} title={tip} onClick={() => setBucket(k)}>{label} ({s.counts[k].toLocaleString("en-US")})</button>)}
              </div>
              <Find q={q} setQ={setQ}>
                {s.plans.length > 0 && <select className="ap-field" aria-label="Plan" value={plan} onChange={(e) => setPlan(e.target.value)}><option value="">All plans</option>{s.plans.map((p) => <option key={p.key} value={p.key}>{p.label} ({p.count})</option>)}</select>}
              </Find>
              {m.rows.length === 0 ? <EmptyState title="No accounts here" body="No client account matches this filter." /> : (
                <>
                  <p className="ap-fine" data-testid="cl3-count">{m.total.toLocaleString("en-US")} {m.total === 1 ? "account" : "accounts"}.</p>
                  <div className="ap-scroll"><table className="ap-t" data-testid="cl3-table"><thead><tr><th>Account</th><th>Plan</th><th>Payment</th><th data-num>Plan price</th>{showApps && <th>SubSync</th>}<th>Credit balance</th><th>Health</th><th className="text-right">Open</th></tr></thead>
                    <tbody>{m.rows.map((x) => (
                      <tr key={x.locationId} style={{ cursor: "default" }} data-tone={x.plan.pay === "past_due" ? "amber" : undefined}>
                        <td><span className="ap-name">{x.name}</span></td>
                        <td>{x.plan.name ?? (x.plan.pay === "none" ? "No plan" : "Plan name not given")}</td>
                        <td title={x.plan.explain}>{x.plan.payLabel}{x.plan.daysInStatus !== null && x.plan.pay !== "paid" && x.plan.pay !== "none" ? <span className="ap-fine"> {x.plan.daysInStatus} {x.plan.daysInStatus === 1 ? "day" : "days"} since we saw it change</span> : null}</td>
                        <td data-num>{x.plan.monthly !== null ? `${cash(x.plan.currency, x.plan.monthly)}/mo` : ""}</td>
                        {showApps && <td title={x.install?.line}>{x.install ? x.install.line : x.subsync === "installed" ? "Installed" : x.subsync === "missing" ? "Not installed" : s.apps.state === "needs_permission" ? "Needs permission: reconnect" : "Not read yet"}{x.install?.endingSoon ? <span className="ap-fine"> trial ends soon</span> : null}</td>}
                        <td>{x.wallet.balance !== null ? (x.wallet.balance <= 0 ? "Empty" : x.wallet.balance.toLocaleString("en-US")) : x.wallet.state === "needs_permission" ? "Needs permission: reconnect" : ""}</td>
                        <td><LevelChip level={x.level} /></td>
                        <td className="text-right"><span className="inline-flex flex-wrap items-center justify-end gap-2">
                          <button type="button" className="ap-link" onClick={() => onOpen(x.locationId)} data-testid="cl3-open-account">Open account</button>
                          {x.url && <OpenLeadButton seed={null} crmUrl={x.url} reason="" name={x.name} testId="cl3-open-crm" />}
                          {(x.plan.pay === "past_due" || x.plan.pay === "cancelled") && <button type="button" className="ap-link" onClick={() => onPayments(x.locationId)}>Payments</button>}
                        </span></td>
                      </tr>
                    ))}</tbody></table></div>
                  <div className="cl-pager" role="navigation" aria-label="Pages">
                    <button type="button" className="s6-btn" disabled={stack.length === 0} onClick={() => setStack(stack.slice(0, -1))}>Previous</button>
                    <button type="button" className="s6-btn" disabled={!m.next} onClick={() => m.next && setStack([...stack, m.next])}>Next</button>
                  </div>
                </>
              )}
              <section className="cl-drill" aria-label="What the platform cannot give" data-testid="cl3-notavail">
                <h3 className="mb-1 text-base font-semibold">Upcoming charges and apps</h3>
                <p className="ap-fine">Next charge date, failed-payment reasons, other marketplace apps in each account, buying an app for every account and bulk install: {NOT_FROM_PLATFORM}. They stay in your CRM.
                  {home && <a className="ap-link" href={home} target="_blank" rel="noreferrer" data-testid="cl3-crm-home">Open your CRM (billing and apps)</a>}</p>
                {showApps && (
                  <div data-testid="cl3-apps">
                    <h3 className="mb-1 mt-2 text-base font-semibold">Marketplace installs (SubSync)</h3>
                    {s.apps.state === "ok" ? (
                      <p className="ap-fine">
                        <button type="button" className="ap-link" onClick={() => setBucket("all")}>{s.apps.installed} installed</button>{", "}
                        <button type="button" className="ap-link" onClick={() => setBucket("app_missing")}>{s.apps.missing} not installed</button>{", "}
                        <button type="button" className="ap-link" onClick={() => setBucket("app_trial")} data-testid="cl3-apps-trial">{s.apps.onTrial} on a trial</button>
                        {s.apps.endingSoon > 0 ? `, ${s.apps.endingSoon} trial ending within 3 days` : ""}{s.apps.unknown ? `, ${s.apps.unknown} not read yet` : ""}. Source: the list the platform gives of accounts where SubSync is installed. The platform gives the trial flag but no trial end date{s.apps.endingSoon === 0 ? ", so a trial ending soon shows only when the install event recorded one" : ""}.
                      </p>
                    ) : s.apps.state === "needs_permission" ? <p className="ap-fine">Needs permission: reconnect and allow SubSync to {scopeList(["oauth.readonly"])}.</p>
                      : <p className="ap-fine">Not read yet. The next hourly read fills this in. If it stays empty, reconnect to let SubSync see where it is installed.</p>}
                  </div>
                )}
              </section>
              {showHistory && !sample && <History onOpen={onOpen} />}
            </>
          );
        }}
      </Load>
    </div>
  );
}

function History({ onOpen }: { onOpen: (id: string) => void }) {
  const [stack, setStack] = useState<string[]>([]);
  const cursor = stack[stack.length - 1];
  const r = useData<Cl3HistoryList>(`clients3?part=money-history&size=20${cursor ? `&cursor=${cursor}` : ""}`);
  const d = r.data;
  return (
    <section className="cl-drill" aria-label="Recent changes" data-testid="cl3-history">
      <h3 className="mb-1 text-base font-semibold">Recent changes</h3>
      {!d ? <p className="ap-fine">Loading...</p> : d.rows.length === 0 ? <p className="ap-fine">Nothing has changed since SubSync started recording. The platform shows only how things are now; from here on we keep the history, so you can see when an account became unpaid.</p> : (
        <>
          <ul className="cl-steps">{d.rows.map((h) => <li key={h.id}><b>{h.name}</b><span>{h.text} {h.at.slice(0, 10)}</span><button type="button" className="ap-link" onClick={() => onOpen(h.locationId)}>Open account</button></li>)}</ul>
          <div className="cl-pager"><button type="button" className="s6-btn" disabled={stack.length === 0} onClick={() => setStack(stack.slice(0, -1))}>Previous</button><button type="button" className="s6-btn" disabled={!d.next} onClick={() => d.next && setStack([...stack, d.next])}>Next</button></div>
        </>
      )}
    </section>
  );
}
