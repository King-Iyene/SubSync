"use client";

import { useMemo, useState } from "react";
import type { PmOptions } from "@/lib/analytics/payments-types";
import { EmptyState, ModuleTabs, Page } from "../../ds";
import type { GoFn } from "../../nav";
import { FinanceModule, FN_GROUPS } from "../fn/module";
import { fnfxOn, useFn } from "../fn/data";
import type { FnOptions } from "../fn/types";
import { usePm, fixturesOn as pmFxOn } from "../pm/data";
import { PaymentsModule } from "../pm/module";
import { ClientPlansCard } from "../pm/sections";

// Money, one menu item: Plans and churn | Client payments | Payouts. It is the old Payments page and the old Finance page under one roof (nothing removed, only the duplicate menu entry):
//   Plans and churn  = Finance Overview, Client revenue and Churn watch, plus the clients' plans card that used to sit in Payments > Upcoming (shown once, here).
//   Client payments  = Payments: Today, Recovery queue, Disputes, Upcoming, History, Setup (failed, late, refunds, disputes).
//   Payouts          = Finance Payouts, Billing notes and Setup (what the team earned, what is billed, the choices only the owner gives).
// The old addresses (#payments, #finance, links from other pages) still open the right tab: the page is told which one to start on.
export type MoneyTab = "plans" | "payments" | "payouts";
const TABS: Record<MoneyTab, [string, string]> = {
  plans: ["Plans and churn", "Plans sold, what clients made, who may leave, and what the plans bring in a month."],
  payments: ["Client payments", "Failed and late payments, refunds and disputes, with what to do next."],
  payouts: ["Payouts", "What your setters and closers earned, what you bill, and the setup only you can give."],
};

export function MoneyModule({ go, start, pmOn, fnOn }: { go: GoFn; start: MoneyTab; pmOn: boolean; fnOn: boolean }) {
  const fn = useFn<FnOptions>("options", {}, { off: !fnOn });
  const pm = usePm<PmOptions>("options", {}, !pmOn);
  const fnTabs = useMemo(() => (fn.data?.tabs ?? []) as string[], [fn.data]);
  const has = (g: "plans" | "payouts") => fnOn && fnTabs.some((t) => (FN_GROUPS[g] as readonly string[]).includes(t));
  const avail = useMemo<MoneyTab[]>(() => {
    const a: MoneyTab[] = [];
    // Until the options arrive every tab the person may have is offered, so the page is not empty while it loads.
    if ((fnOn && (fn.data === null || has("plans"))) || pmOn) a.push("plans");
    if (pmOn && (pm.data === null || pm.data.canSee !== false)) a.push("payments");
    if (fnOn && (fn.data === null || has("payouts"))) a.push("payouts");
    return a;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fnOn, pmOn, fn.data, pm.data]);
  const [picked, setPicked] = useState<{ tab: MoneyTab; sub?: string }>({ tab: start });
  const active: MoneyTab = avail.includes(picked.tab) ? picked.tab : avail[0] ?? "plans";
  const fx = fnfxOn() || pmFxOn();
  const switchTo = (top: "plans" | "payouts", sub: string) => setPicked({ tab: top, sub });
  const subOf = (t: MoneyTab) => (picked.tab === t ? picked.sub : undefined);

  if (avail.length === 0 && (fn.data || pm.data)) return <div className="s6 ap ds-enter" data-testid="money-module"><Page title="Money" subtitle="Plans, client payments and payouts in one place."><EmptyState title="Nothing here is switched on yet" body="The parts of Money appear here as soon as they are ready for your account." /></Page></div>;
  return (
    <div className="s6 ap ds-enter" data-testid="money-module">
      <Page title="Money" subtitle="Plans, client payments and payouts in one place. Each number appears once.">
        {fx && <p className="ap-fine mb-2" role="status">Sample data: these are not your real numbers.</p>}
        {avail.length > 1 && <ModuleTabs pill label="Money sections" tabs={avail.map((k) => ({ label: k === "payouts" && fn.data?.manager === false ? "My payouts" : TABS[k][0], tip: TABS[k][1], node: null }))} value={Math.max(0, avail.indexOf(active))} onChange={(i) => setPicked({ tab: avail[i] })} />}
        <div data-testid={`money-tab-${active}`} key={active}>
          {active === "plans" && (
            <>
              {fnOn && has("plans") && <FinanceModule go={go} embed="plans" initialTab={subOf("plans")} switchTo={switchTo} />}
              {pmOn && <div className="mt-3"><ClientPlansCard /></div>}
            </>
          )}
          {active === "payments" && <PaymentsModule go={go} embed />}
          {active === "payouts" && <FinanceModule go={go} embed="payouts" initialTab={subOf("payouts")} switchTo={switchTo} />}
        </div>
      </Page>
    </div>
  );
}
