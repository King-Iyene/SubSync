"use client";

import { useEffect, useMemo, useState } from "react";
import type { PpListRow, PpOptions, PpPage } from "@/lib/analytics/people3-types-interim";
import { EmptyState, ModuleTabs, Page } from "../../ds";
import type { GoFn } from "../../nav";
import "../speed6.css";
import "../speed-ui.css";
import "../ap3/ap3.css";
import "./pp3.css";
import { fixturesOn, usePp, type PpParams } from "./data";
import { PersonPanel, type Drill } from "./panel";
import { Scorecards, Today, Workload, type SecProps } from "./sections";
import { Access, Coaching, Leaderboard, Money, Proof } from "./sections2";
import { ago, Load, money, Pager, useCursor } from "./shared";

// Team, one screen (the Clients module pattern): Today | Scorecards | Workload | Leaderboard | Money | Coaching | Access | Proof, and a panel for one person.
// REAL synced data only; "idle" always reads "no activity recorded in your CRM". Reads only here; the actions builder mounts its pieces through actions-slot.tsx.
// Every number is a count that opens its rows. Sample data appears ONLY with ?ppfx=1 and is labelled "Sample data".
type TabKey = "today" | "scorecards" | "workload" | "leaderboard" | "money" | "coaching" | "access" | "proof";
const TIPS: Record<TabKey, [string, string]> = {
  today: ["Today", "Who needs you today, in one sentence."], scorecards: ["Scorecards", "One row per person: replies, appointments, shows, deals won."],
  workload: ["Workload", "Who has too much and who has room, against the team's own normal."], leaderboard: ["Leaderboard", "A fair ranking inside each account."],
  money: ["Money", "Deals won, open and at risk, per person and per account."], coaching: ["Coaching", "One thing to work on for each person, and your notes."],
  access: ["Access", "Which accounts each person works in, and where one person does it all."], proof: ["Proof", "A summary for a client of how the team handled their leads."],
};
const FLAG_OF: Record<TabKey, string> = { today: "pp_today", scorecards: "pp_scorecards", workload: "pp_workload", leaderboard: "pp_leaderboard", money: "pp_money", coaching: "pp_coaching", access: "pp_access", proof: "pp_proof" };
const OWN_TABS: TabKey[] = ["today", "scorecards", "leaderboard"];
const PERIODS = [[7, "Last 7 days"], [30, "Last 30 days"], [90, "Last 90 days"]] as const;
const NO_PERIOD: TabKey[] = ["today", "workload", "coaching", "access"];

const REASON_NOUN: Record<string, string> = { waiting: "Waiting for a reply", idle: "Last reply", no_outcome: "Appointment time passed, no outcome", open: "Open lead", handled: "Lead handled", won: "Won" };
function DrillList({ d, filters, onClose }: { d: Drill; filters: PpParams; onClose: () => void }) {
  const f = { ...filters, reason: d.reason, user: d.userId ?? undefined, location: d.location ?? filters.location, expect: fixturesOn() ? d.count : undefined }, c = useCursor(JSON.stringify(f));
  const r = usePp<PpPage<PpListRow>>("list", { ...f, cursor: c.cursor });
  return (
    <section id="pp-drill" className="pp-drill" data-testid="pp-drill" aria-label={d.title}>
      <div className="mb-2 flex flex-wrap items-center gap-3"><h3 className="text-base font-semibold" data-testid="pp-drill-title">{d.title}</h3><span className="ap-chip" data-tone="cyan">{d.count.toLocaleString("en-US")}</span><button type="button" className="ap-link ml-auto" onClick={onClose}>Close</button></div>
      <Load r={r} empty={(x) => x.rows.length === 0 && "Nothing behind this one in these dates."}>
        {(x) => (
          <>
            <div className="ap-scroll"><table className="ap-t" data-testid="pp-drill-list"><thead><tr><th>Lead</th><th data-sm="hide">Account</th><th>What</th><th data-sm="hide">When</th><th /></tr></thead>
              <tbody>{x.rows.map((row, i) => <tr key={`${row.locationId}:${row.contactName}:${i}`} style={{ cursor: "default" }}><td>{row.contactName}</td><td data-sm="hide">{row.accountName}</td><td>{row.detail ?? REASON_NOUN[d.reason] ?? ""}{row.value ? ` (${money(row.value)})` : ""}</td><td data-sm="hide">{row.at ? ago(row.at) : ""}</td>
                <td>{row.url ? <a className="ap-link" href={row.url} target="_blank" rel="noopener noreferrer">Open in your CRM</a> : <span className="ap-fine">Link not available</span>}</td></tr>)}</tbody></table></div>
            <Pager c={c} next={x.next} total={x.total} />
          </>
        )}
      </Load>
    </section>
  );
}

export function TeamModule({ go }: { go: GoFn }) {
  void go;
  const sample = fixturesOn(), opt = usePp<PpOptions>("options");
  const flags = (opt.data?.flags ?? null) as Record<string, boolean> | null, ownRow = opt.data?.ownRowOnly === true;
  const [days, setDays] = useState<number>(30), [location, setLocation] = useState(""), [drill, setDrill] = useState<Drill | null>(null), [person, setPerson] = useState<{ id: string; ids: string[] } | null>(null), [since] = useState(() => Date.now());
  const tabs = useMemo(() => {
    const all = (Object.keys(TIPS) as TabKey[]).filter((k) => !ownRow || OWN_TABS.includes(k));
    return all.filter((k) => flags === null || flags[FLAG_OF[k]] !== false);
  }, [flags, ownRow]);
  const [tab, setTab] = useState<TabKey>("today"), active = tabs.includes(tab) ? tab : tabs[0] ?? "today", index = Math.max(0, tabs.indexOf(active));
  const filters = useMemo<PpParams>(() => ({ from: days === 30 ? undefined : new Date(since - days * 86_400_000).toISOString().slice(0, 10), location: location || undefined }), [days, location, since]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setDrill(null); }, [active]);
  const accounts = opt.data?.accounts ?? [];
  const open = (d: Drill) => { setPerson(null); setDrill(d); setTimeout(() => document.getElementById("pp-drill")?.scrollIntoView({ block: "nearest", behavior: "smooth" }), 50); };
  const props: SecProps = { filters, open, pick: (id, ids) => setPerson({ id, ids }), accounts, ownRow };

  if (opt.data && !ownRow && opt.data.canSeeEveryone === false && accounts.length === 0) return <Page title="Team" subtitle="Who is slow, who is overloaded, who earns the money." actions={null}><EmptyState title="No people to show yet" body="Your team appears here once its first messages and calls have synced." /></Page>;
  const body = (() => {
    switch (active) {
      case "today": return <Today filters={filters} open={open} />;
      case "scorecards": return <Scorecards {...props} />;
      case "workload": return <Workload {...props} />;
      case "leaderboard": return <Leaderboard {...props} />;
      case "money": return <Money {...props} />;
      case "coaching": return <Coaching {...props} />;
      case "access": return <Access {...props} />;
      case "proof": return <Proof {...props} />;
    }
  })();
  return (
    <div className="s6 ap pp ds-enter" data-testid="pp-module">
      <Page title="Team" subtitle={ownRow ? "Your own numbers and your own queue." : "Who is slow, who is overloaded, and who earns the money, in every client account."} actions={null}>
        {sample && <p className="ap-fine mb-2" role="status" data-testid="pp-sample">Sample data: these are not your real people.</p>}
        {opt.data?.problem && <p className="ap-fine mb-2" role="status">{opt.data.problem}</p>}
        <div className="pp-box">
        <ModuleTabs pill label="Team sections" tabs={tabs.map((k) => ({ label: TIPS[k][0], tip: TIPS[k][1], node: null }))} value={index} onChange={(i) => setTab(tabs[i])} />
        {!ownRow && (accounts.length > 1 || !NO_PERIOD.includes(active)) && (
          <div className="ap-head print:hidden" role="group" aria-label="Filters">
            {!NO_PERIOD.includes(active) && <select className="ap-field" aria-label="Period" value={days} onChange={(e) => setDays(Number(e.target.value))}>{PERIODS.map(([d, l]) => <option key={d} value={d}>{l}</option>)}</select>}
            {accounts.length > 1 && active !== "access" && active !== "proof" && <select className="ap-field" aria-label="Client account" value={location} onChange={(e) => setLocation(e.target.value)} data-testid="pp-account"><option value="">All client accounts</option>{accounts.map((a) => <option key={a.locationId} value={a.locationId}>{a.name}</option>)}</select>}
            <span className="ap-fine">Every number below follows these choices{opt.data?.generatedAt ? `. Updated ${opt.data.generatedAt.slice(0, 10)}` : ""}.</span>
          </div>
        )}
        {ownRow && !NO_PERIOD.includes(active) && <div className="ap-head print:hidden"><select className="ap-field" aria-label="Period" value={days} onChange={(e) => setDays(Number(e.target.value))}>{PERIODS.map(([d, l]) => <option key={d} value={d}>{l}</option>)}</select></div>}
        <div data-testid={`pp-tab-${active}`}>{body}</div>
        {drill && <DrillList d={drill} filters={filters} onClose={() => setDrill(null)} />}
        <p className="ap-fine mt-6">SubSync reads message and call metadata, never the words. History starts {opt.data?.historyStarts ?? "when SubSync first synced"}.</p>
        </div>
        {person && <PersonPanel key="panel" userId={person.id} ids={person.ids} onSelect={(id) => setPerson({ id, ids: person.ids })} onClose={() => setPerson(null)} onDrill={open} filters={{ from: filters.from }} />}
      </Page>
    </div>
  );
}
