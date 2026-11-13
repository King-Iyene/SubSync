"use client";

import { useMemo, useState } from "react";
import { EmptyState, ModuleTabs, Page } from "../../ds";
import type { GoFn } from "../../nav";
import "../speed6.css";
import "../speed-ui.css";
import "../ap3/ap3.css";
import "../cl3/cl3.css";
import "./fn.css";
import { fnfxOn, notSwitchedOn, useFn, useWindow } from "./data";
import { ChurnTab } from "./churn";
import { LedgerTab } from "./ledger";
import { OverviewTab } from "./overview";
import { PayoutsTab } from "./payouts";
import { RevenueTab } from "./revenue";
import { SetupTab } from "./setup";
import { Load, SampleNote } from "./shared";
import type { FnHeadline, FnOptions } from "./types";

// Finance, one screen (the Payments and Clients module pattern): Overview | Client revenue | Churn watch | Payouts | Billing notes | Setup. It is the agency's OWN money: plans sold and what is at risk, what its
// clients made, who may leave, what it owes its setters and closers, and what it bills. Payments (next to it) is what clients owe right now; Finance links to it instead of repeating it. The date bar above drives every
// number; the account bar narrows it. Real data only; sample rows appear only with ?fnfx and say "Sample data". A person without manager rights sees one tab: their own payout statement.
type TabKey = "overview" | "revenue" | "churn" | "payouts" | "ledger" | "setup";
const TIPS: Record<TabKey, [string, string]> = {
  overview: ["Overview", "Plans a month, what moved, and what is at risk."], revenue: ["Client revenue", "What each client made through your work."], churn: ["Churn watch", "Client accounts that may leave, and how to keep them."],
  payouts: ["Payouts", "What your setters and closers earned, line by line."], ledger: ["Billing notes", "What you bill each client, and what is overdue."], setup: ["Payout setup", "Prices, ad spend and payout choices only you can give."],
};
const FLAG_OF: Record<TabKey, string> = { overview: "fn_mrr", revenue: "fn_revenue", churn: "fn_churn", payouts: "fn_payouts", ledger: "fn_ledger", setup: "fn_module" };

/** Which tabs of Finance sit in which Money tab: Plans and churn, or Payouts (payouts, billing notes, setup). */
export const FN_GROUPS = { plans: ["overview", "revenue", "churn"], payouts: ["payouts", "ledger", "setup"] } as const;

export function FinanceModule({ go, embed, initialTab, switchTo }: { go: GoFn; /** Inside the Money page: only that group of tabs, and no page title of its own. */ embed?: "plans" | "payouts"; initialTab?: string; /** Money page: a link to a tab that lives in the other group switches the top tab. */ switchTo?: (top: "plans" | "payouts", tab: string) => void }) {
  const opt = useFn<FnOptions>("options");
  const win = useWindow();
  const [tab, setTab] = useState<TabKey>((initialTab as TabKey) || (embed === "payouts" ? "payouts" : "overview"));
  const flags = opt.data?.flags ?? null;
  const tabs = useMemo(() => (opt.data ? (opt.data.tabs as TabKey[]).filter((k) => (flags === null || flags[FLAG_OF[k]] !== false) && (!embed || (FN_GROUPS[embed] as readonly string[]).includes(k))) : []), [opt.data, flags, embed]);
  const active = tabs.includes(tab) ? tab : tabs[0];
  const goTab = (t: string) => { const other = embed && !(FN_GROUPS[embed] as readonly string[]).includes(t) ? (embed === "plans" ? "payouts" : "plans") : null; if (other && switchTo) switchTo(other, t); else setTab(t as TabKey); };
  const manager = opt.data?.manager === true;
  const ranged = active === "overview" || active === "revenue" || active === "payouts";

  if (!fnfxOn() && opt.error && notSwitchedOn(opt.error)) return <div className="s6 ap fn ds-enter" data-testid="fn-module"><Page title="Finance" subtitle="Your own money: plans, what clients made, who may leave, and what you pay your team."><EmptyState title="Finance is not switched on yet" body="It will appear here as soon as it is ready for your account." /></Page></div>;
  return (
    <div className="s6 ap fn ds-enter" data-testid="fn-module">
      <FnFrame embed={!!embed} subtitle={manager ? "Your own money: plans, what clients made, who may leave, and what you pay your team." : "Your own payout statement, line by line."}>
        {fnfxOn() && <div className="mb-2"><SampleNote /></div>}
        <Load r={opt} label="Opening Finance...">
          {() => (
            <>
              {manager && embed !== "payouts" && <HeadlineStrip goTab={goTab} go={go} />}
              {tabs.length === 0 ? <EmptyState title="Nothing is switched on yet" body="The parts of Finance will appear here as soon as they are ready for your account." /> : (
                <>
                  <ModuleTabs pill label="Finance sections" tabs={tabs.map((k) => ({ label: manager || k !== "payouts" ? TIPS[k][0] : "My payouts", tip: TIPS[k][1], node: null }))} value={Math.max(0, tabs.indexOf(active))} onChange={(i) => setTab(tabs[i])} />
                  {ranged && win.label && <p className="ap-fine" data-testid="fn-range-label" style={{ margin: "8px 0" }}>Showing {win.label}. Change it with the date bar above.</p>}
                  <div data-testid={`fn-tab-${active}`}>
                    {active === "overview" && <OverviewTab go={go} goTab={goTab} />}
                    {active === "revenue" && <RevenueTab go={go} goTab={goTab} />}
                    {active === "churn" && <ChurnTab go={go} />}
                    {active === "payouts" && opt.data && <PayoutsTab options={opt.data} goTab={goTab} />}
                    {active === "ledger" && <LedgerTab />}
                    {active === "setup" && <SetupTab />}
                  </div>
                </>
              )}
            </>
          )}
        </Load>
      </FnFrame>
    </div>
  );
}

function FnFrame({ embed, subtitle, children }: { embed: boolean; subtitle: string; children: React.ReactNode }) {
  return embed ? <>{children}</> : <Page title="Finance" subtitle={subtitle}>{children}</Page>;
}

/** The CEO money line and the one "what to do today" line, from the counts. */
function HeadlineStrip({ goTab, go }: { goTab: (t: string) => void; go: GoFn }) {
  const r = useFn<FnHeadline>("headline");
  const d = r.data;
  if (!d) return null;
  const to = d.target === "overview" ? () => go("payments") : d.target === "churn" ? () => goTab("churn") : d.target === "ledger" ? () => goTab("ledger") : d.target === "payouts" ? () => goTab("payouts") : d.target === "setup" ? () => goTab("setup") : null;
  return (
    <section className="fn-card" aria-label="Money headline" style={{ marginBottom: 14 }} data-testid="fn-headline">
      <p className="fn-h">Money today</p>
      <p className="fn-sentence" data-testid="fn-headline-line">{d.line}</p>
      <p className="fn-lead" data-testid="fn-headline-today" style={{ marginTop: 4 }}><b>What to do today:</b> {d.today}</p>
      {to && <button type="button" className="s6-btn" data-kind="primary" style={{ marginTop: 8 }} onClick={to} data-testid="fn-headline-go">{d.target === "overview" ? "Open Payments" : d.target === "churn" ? "Open the watch list" : d.target === "ledger" ? "Open billing notes" : d.target === "payouts" ? "Open payouts" : "Open Setup"}</button>}
    </section>
  );
}
