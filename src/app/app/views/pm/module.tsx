"use client";

import { useMemo, useState } from "react";
import type { PmOptions } from "@/lib/analytics/payments-types";
import { useApiClient } from "../../session";
import { EmptyState, ModuleTabs, Page } from "../../ds";
import { usePageRange } from "../../ds/page-range";
import type { GoFn } from "../../nav";
import { Btn } from "../../ui";
import "../speed6.css";
import "../speed-ui.css";
import "../ap3/ap3.css";
import "./pm.css";
import { fixturesOn, usePm } from "./data";
import { NO_FILTERS, QueueTab, type QFilters } from "./queue";
import { DisputesTab, HistoryTab, SetupTab, TodayTab, UpcomingTab } from "./sections";

// Payments, one screen (the Clients and Pipeline module pattern): Today | Recovery queue | Disputes | Upcoming | History | Setup. READ ONLY except SubSync's own notes and dispute log; nothing here
// messages anyone or changes the CRM. Every number opens exactly its rows. Sample data appears ONLY with ?pmfx=1 and is labelled "Sample data".
type TabKey = "today" | "queue" | "disputes" | "upcoming" | "history" | "setup";
const TIPS: Record<TabKey, [string, string]> = {
  today: ["Today", "What needs action, in one sentence."], queue: ["Recovery queue", "Failed payments, late invoices and past due plans, biggest and oldest first."],
  disputes: ["Disputes", "A log you keep, with evidence due dates."], upcoming: ["Upcoming", "What to expect (estimates) and what the platform does not tell us."],
  history: ["History", "How long payments take to fix, from our own record."], setup: ["Setup", "What we can read and what to check."],
};
const FLAG_OF: Partial<Record<TabKey, string>> = { queue: "pm_recovery", disputes: "pm_disputes", upcoming: "pm_upcoming", history: "pm_recovery" };

export function PaymentsModule({ go }: { go: GoFn }) {
  void go;
  const api = useApiClient(), sample = fixturesOn();
  const bar = usePageRange();
  const opt = usePm<PmOptions>("options");
  const flags = (opt.data?.flags ?? null) as Record<string, boolean> | null;
  const tabs = useMemo(() => (["today", "queue", "disputes", "upcoming", "history", "setup"] as TabKey[]).filter((k) => !FLAG_OF[k] || flags === null || flags[FLAG_OF[k] as string] !== false), [flags]);
  const [tab, setTab] = useState<TabKey>("today"), [q, setQ] = useState<QFilters>(NO_FILTERS), [qKey, setQKey] = useState(0), [rev, setRev] = useState(0), [dStatus, setDStatus] = useState("");
  const active = tabs.includes(tab) ? tab : tabs[0];
  const goTab = (t: string) => setTab(t as TabKey);
  const openQueue = (f: Partial<QFilters>) => { setQ({ ...NO_FILTERS, ...f }); setQKey((n) => n + 1); setTab("queue"); };
  const bump = () => setRev((n) => n + 1);

  if (opt.data && opt.data.canSee === false) return <div className="s6 ap pm ds-enter" data-testid="pm-module"><Page title="Payments" subtitle="Who has not paid, how much, and for how long." actions={null}><EmptyState title="Payments is for owners and administrators" body="It shows money that needs chasing. Ask the owner of your account to open it." /></Page></div>;
  return (
    <div className="s6 ap pm ds-enter" data-testid="pm-module">
      <Page title="Payments" subtitle="Who has not paid, how much, for how long, and what to do next." actions={sample ? null : <Btn onClick={() => void api.download("payments?part=export", "payments.csv")}>Export CSV</Btn>}>
        {sample && <p className="ap-fine mb-2" role="status" data-testid="pm-sample">Sample data: these are not your real payments.</p>}
        {opt.data?.problem && <p className="ap-fine mb-2" role="status">{opt.data.problem}</p>}
        <p className="ap-fine mb-2" data-testid="pm-dates">Dates: {bar.label}, from the bar above. They set the problems listed (by the day they were flagged), disputes opened or due in them, the recovered money, the refunds and the history.</p>
        <ModuleTabs pill label="Payments sections" tabs={tabs.map((k) => ({ label: TIPS[k][0], tip: TIPS[k][1], node: null }))} value={Math.max(0, tabs.indexOf(active))} onChange={(i) => setTab(tabs[i])} />
        <div data-testid={`pm-tab-${active}`}>
          {active === "today" && <TodayTab go={goTab} openQueue={openQueue} openDisputes={() => { setDStatus("open"); setTab("disputes"); }} />}
          {active === "queue" && <QueueTab key={qKey} initial={q} options={opt.data ?? null} rev={rev} bump={bump} />}
          {active === "disputes" && <DisputesTab key={dStatus} options={opt.data ?? null} initialStatus={dStatus} rev={rev} bump={bump} />}
          {active === "upcoming" && <UpcomingTab />}
          {active === "history" && <HistoryTab openAccount={(id) => openQueue({ location: id, status: "all" })} />}
          {active === "setup" && <SetupTab />}
        </div>
      </Page>
    </div>
  );
}
