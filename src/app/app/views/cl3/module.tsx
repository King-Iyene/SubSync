"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { Cl2Today } from "@/lib/analytics/clients2-types";
import type { Cl3Account, Cl3Attention, Cl3List, Cl3Options, Cl3Overview, Cl3Reason } from "@/lib/analytics/clients3-types";
import { useApiClient, useData } from "../../session";
import { EmptyState, ModuleTabs, OpenLeadButton, Page } from "../../ds";
import { Btn } from "../../ui";
import type { GoFn } from "../../nav";
import { ClientPage } from "../clients/client-page";
import { HealthTab } from "../clients/health-tab";
import { IndustriesTab } from "../clients/industries";
import { OnboardingTab } from "../clients/onboarding-tab";
import { ReviewsTab } from "../clients/reviews";
import type { ClientsFeatures } from "../clients";
import "../speed6.css";
import "../speed-ui.css";
import "../ap3/ap3.css";
import "./cl3.css";
import { fixturesOn, useCl, type ClParams } from "./data";
import { AccountSettings } from "./settings";
import { MoneyTab } from "./money";
import { AccountPage } from "../cl2/account-page";
import { AccountsTab, type Filter as AcctFilter } from "../cl2/accounts";
import { Plans as PlansTab, TodayPanel } from "../cl2/plans";
import "../cl2/cl2.css";
import { Compare, People, Reports, Setup, Trends } from "./sections";
import { ProofTab } from "../pr/module";
import { ago, change, day, Find, LevelChip, Load, money, Pager, share } from "./shared";

// Clients, one screen (the Appointments and Pipeline module pattern): Overview | Needs attention | Trends | Compare accounts | Reports | People | Setup health | Health and risk,
// then the older Onboarding, Reviews (QBR) and Industries pages. Reads only; the only writes are SubSync's own quiet marks, reply targets and owner names (settings panel).
// Every number is a count that opens its rows. Nothing here messages anyone or changes the CRM. Sample data appears ONLY with ?clfx=1 and is labelled "Sample data".
type Drill = { title: string; reason: Cl3Reason; location: string | null; count: number } | null;
type TabKey = "overview" | "money" | "accounts" | "plans" | "needs" | "trends" | "compare" | "reports" | "proof" | "people" | "setup" | "health" | "onboarding" | "reviews" | "industries";
const TIPS: Record<TabKey, [string, string]> = {
  overview: ["Overview", "What to do today, in one sentence."], money: ["Money", "Plans, who has not paid, credit balances, and whether SubSync is installed, for every client account."], accounts: ["Accounts", "Every client account: paid plan, payment status, health, who looks after it."], plans: ["Plans", "Paid plans that are past due, cancelled or paused, with a note field."], needs: ["Needs attention", "Accounts ranked by what is wrong, with the count behind each reason."],
  trends: ["Trends", "Week on week or month on month, from our own record."], compare: ["Compare accounts", "Two accounts side by side."],
  reports: ["Reports", "A weekly proof for each client to show them."], proof: ["Proof", "One branded page and a monthly report for each client, to send them yourself."], people: ["People", "Who works in which account, and who has gone quiet."],
  setup: ["Setup health", "Connection, permissions, how fresh the data is, and each client's plan."], health: ["Health and risk", "Overall health, who may be slipping, and the standard workflows each client has."],
  onboarding: ["Onboarding", "One checklist per client."], reviews: ["Reviews (QBR)", "The quarterly review of one client."], industries: ["Industries", "Clients grouped by industry, with playbooks and reply targets."],
};
// Clients v2 tabs show only when their flag is on (a missing flag means off); the older tabs hide only when their flag is explicitly off.
const C2_FLAG_OF: Partial<Record<TabKey, string>> = { money: "cl3_money", accounts: "cl2_accounts", plans: "cl2_plans", proof: "pr_report" };
const FLAG_OF: Partial<Record<TabKey, string>> = { overview: "cl_overview", needs: "cl_attention", trends: "cl_trends", compare: "cl_compare", reports: "cl_reports", people: "cl_people", setup: "cl_setup" };
const PERIODS = [[7, "Last 7 days"], [30, "Last 30 days"], [90, "Last 90 days"]] as const;
const ALL_FEATURES: ClientsFeatures = { health: true, onboarding: true, clients: true, reports: true, setupCompare: true, playbooks: true };

function DrillList({ d, filters, onClose, openAccount }: { d: NonNullable<Drill>; filters: ClParams; onClose: () => void; openAccount: (id: string) => void }) {
  const [page, setPage] = useState(0);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setPage(0); }, [d.reason, d.location]);
  const r = useCl<Cl3List>("list", { ...filters, reason: d.reason, location: d.location ?? undefined, page, size: 20 });
  return (
    <section id="cl-drill" className="cl-drill" data-testid="cl-drill" aria-label={d.title}>
      <div className="mb-2 flex flex-wrap items-center gap-3"><h3 className="text-base font-semibold" data-testid="cl-drill-title">{d.title}</h3><span className="ap-chip" data-tone="cyan">{d.count.toLocaleString("en-US")}</span><button type="button" className="ap-link ml-auto" onClick={onClose}>Close</button></div>
      <Load r={r} empty={(x) => x.rows.length === 0 && "Nothing behind this one in these dates."}>
        {(x) => (
          <>
            <div className="ap-scroll"><table className="ap-t" data-testid="cl-drill-list"><thead><tr><th>Contact</th>{!d.location && <th>Account</th>}<th>What</th><th>When</th><th className="text-right">Open</th></tr></thead>
              <tbody>{x.rows.map((row, i) => <tr key={`${row.locationId}:${row.contactId ?? i}:${i}`} style={{ cursor: "default" }}><td>{row.contactName}</td>{!d.location && <td>{row.accountName}</td>}<td>{row.detail ?? ""}{row.value ? ` (${money(row.value)})` : ""}</td><td>{row.at ? ago(row.at) : ""}</td>
                <td className="text-right">{row.contactId ? <OpenLeadButton seed={{ contactId: row.contactId, locationId: row.locationId, name: row.contactName, locationName: row.accountName, url: row.url ?? undefined, ...(row.detail ? { pending: row.detail } : {}) }} crmUrl={row.url} name={row.contactName} showAccount={!d.location} testId="cl-open-lead" /> : <span className="inline-flex items-center gap-2"><button type="button" className="ap-link" onClick={() => openAccount(row.locationId)} data-testid="cl-open-account">Open account</button>{row.url && <OpenLeadButton seed={null} crmUrl={row.url} reason="" name={row.accountName} testId="cl-account-crm" />}</span>}</td></tr>)}</tbody></table></div>
            <Pager page={x.page} pages={x.pages} total={x.total} set={setPage} />
          </>
        )}
      </Load>
    </section>
  );
}

function Overview({ filters, open, go, c2, onTile, onButton }: { filters: ClParams; open: (d: NonNullable<Drill>) => void; go: (t: TabKey) => void; c2: boolean; onTile: (t: Cl2Today["tiles"][number]) => void; onButton: (b: NonNullable<Cl2Today["button"]>) => void }) {
  const r = useCl<Cl3Overview>("overview", filters);
  return (
    <Load r={r} empty={(o) => o.accounts === 0}>
      {(o) => {
        const b = o.today.button, need = o.act + o.watch, nl = change(o.totals.newLeads);
        const tile = (label: string, n: number, fn: () => void, sub?: string | null) => <button key={label} type="button" className="cl-tile" onClick={fn}><b>{n.toLocaleString("en-US")}</b><span>{label}{sub ? ` (${sub})` : ""}</span></button>;
        return (
          <div className="cl-stack" data-testid="cl-overview">
            {c2 ? <TodayPanel onButton={onButton} onTile={onTile} /> : (
            <section className="cl-today" aria-label="What to do today">
              <h2 className="cl-h">What to do today</h2>
              <p className="cl-sentence" data-testid="cl-today-sentence">{o.today.headline}</p>
              {b && <button type="button" className="s6-btn" data-kind="primary" data-testid="cl-today-go" onClick={() => open({ title: `${b.label}: ${o.today.headline}`, reason: b.reason, location: b.locationId, count: b.count })}>{b.label} ({b.count.toLocaleString("en-US")})</button>}
            </section>)}
            <div className="cl-tiles">
              {tile("Client accounts", o.accounts, () => go(c2 ? "accounts" : "needs"))}
              {tile("Need a look", need, () => go("needs"))}
              {tile("Leads waiting for a reply", o.totals.waiting, () => open({ title: "Leads waiting for a reply", reason: "waiting", location: null, count: o.totals.waiting }))}
              {tile("Appointments with no outcome", o.totals.unmarked, () => open({ title: "Appointments with no outcome", reason: "unmarked", location: null, count: o.totals.unmarked }))}
              {tile("New leads", o.totals.newLeads.current, () => go("trends"), nl)}
            </div>
            {o.topReasons.length > 0 && (
              <section aria-label="What is wrong most often">
                <h2 className="cl-h mb-2">What is wrong most often</h2>
                <div>{o.topReasons.map((t) => <button key={t.reason} type="button" className="cl-reason" title={t.why} onClick={() => open({ title: t.label, reason: t.reason, location: null, count: t.count })}>{t.label}</button>)}</div>
              </section>
            )}
            {o.worst.length > 0 && (
              <section aria-label="Needs you most">
                <h2 className="cl-h mb-2">Needs you most</h2>
                <ul className="cl-steps">{o.worst.map((w) => <li key={w.locationId}><b>{w.name}</b><span>{w.summary}</span><button type="button" className="ap-link" onClick={() => go("needs")}>See all</button></li>)}</ul>
              </section>
            )}
            <p className="ap-fine">{o.historyStarts ? `Trends use our own record, which starts ${o.historyStarts}.` : "Trends start once we have a few weeks of record."}</p>
          </div>
        );
      }}
    </Load>
  );
}

const SORTS: Array<[string, string]> = [["", "Most to fix"], ["name", "Name"], ["leads", "New leads"], ["waiting", "Waiting for a reply"], ["unmarked", "No outcome"], ["won", "Money won"]];
const MUTE_SHORT: Record<string, string> = { all: "everything", replies: "waiting replies", noshows: "no-shows", stale: "quiet deals", renewal: "renewal" };
function Needs({ filters, open, rev, bump, openClient }: { filters: ClParams; open: (d: NonNullable<Drill>) => void; rev: number; bump: () => void; openClient: (id: string) => void }) {
  const [q, setQ] = useState(""), [dq, setDq] = useState(""), [page, setPage] = useState(0), [level, setLevel] = useState(""), [sort, setSort] = useState(""), [cfg, setCfg] = useState<{ id: string; name: string } | null>(null);
  useEffect(() => { const t = setTimeout(() => { setDq(q); setPage(0); }, 300); return () => clearTimeout(t); }, [q]);
  const key = JSON.stringify(filters);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setPage(0); }, [key, level, sort]);
  const r = useCl<Cl3Attention>("needs-attention", { ...filters, q: dq, page, size: 20, level, sort, dir: sort === "name" ? "asc" : undefined, v: rev || undefined });
  const owners = useData<{ ready: boolean; owners: Record<string, string> }>(fixturesOn() ? null : "clients/act/owners");
  return (
    <div data-testid="cl-needs">
      <Find q={q} setQ={setQ}>
        <select className="ap-field" aria-label="Show" value={level} onChange={(e) => setLevel(e.target.value)}><option value="">All accounts</option><option value="act">Act now</option><option value="watch">Keep an eye</option><option value="ok">Fine</option></select>
        <select className="ap-field" aria-label="Sort by" value={sort} onChange={(e) => setSort(e.target.value)}>{SORTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
      </Find>
      <Load r={r} empty={(p) => p.rows.length === 0 && (level === "act" || level === "watch" ? "No account is in this state right now." : false)}>
        {(p) => (
          <>
            <p className="ap-fine mb-2">{p.levels.act} act now, {p.levels.watch} to keep an eye on, {p.levels.ok} fine{p.levels.unknown ? `, ${p.levels.unknown} with no data yet` : ""}.</p>
            <div className="ap-scroll"><table className="ap-t" data-testid="cl-table"><thead><tr><th>Account</th><th>What needs a look</th><th data-num>New leads</th><th data-num>Waiting</th><th data-num>Stuck deals</th><th /></tr></thead>
              <tbody>{p.rows.map((a: Cl3Account) => {
                const nl = change(a.newLeads), who = owners.data?.owners?.[a.locationId];
                return (
                  <tr key={a.locationId} style={{ cursor: "default" }} data-tone={a.level === "act" ? "amber" : undefined}>
                    <td><span className="ap-name">{a.name}</span><br /><LevelChip level={a.level} />{who && <span className="ap-fine"> Looked after by {who}</span>}{a.quieted && a.quieted.length > 0 && <span className="ap-fine"> Quiet: {a.quieted.map((k) => MUTE_SHORT[k] ?? k).join(", ")}</span>}</td>
                    <td className="cl-reasons">{a.reasons.length ? a.reasons.map((x) => <button key={x.reason} type="button" className="cl-reason" title={x.why} onClick={() => open({ title: `${a.name}: ${x.label}`, reason: x.reason, location: a.locationId, count: x.count })}>{x.label}</button>) : <span className="ap-fine">{a.level === "unknown" ? "No data yet" : "All good"}</span>}</td>
                    <td data-num>{a.newLeads.current}{nl && <span className="ap-sub"> {nl}</span>}</td>
                    <td data-num>{a.waiting > 0 ? <button type="button" className="ap-link" onClick={() => open({ title: `${a.name}: waiting for a reply`, reason: "waiting", location: a.locationId, count: a.waiting })}>{a.waiting}</button> : 0}</td>
                    <td data-num>{share(a.staleDealsPct)}</td>
                    <td><button type="button" className="ap-link" onClick={() => openClient(a.locationId)}>Client page</button>{" "}<button type="button" className="ap-link" onClick={() => setCfg({ id: a.locationId, name: a.name })}>Settings</button></td>
                  </tr>
                );
              })}</tbody></table></div>
            <Pager page={p.page} pages={p.pages} total={p.total} set={setPage} />
          </>
        )}
      </Load>
      {cfg && <AccountSettings key={cfg.id} id={cfg.id} name={cfg.name} onClose={() => setCfg(null)} onChanged={bump} />}
    </div>
  );
}

function Health() {
  if (fixturesOn()) return <EmptyState title="Sample data has no health and risk" body="Open Clients without the sample switch to see your own clients here." />;
  return <HealthTab />;
}

type Names = { clients: Array<{ locationId: string; name: string; score?: number }> };
function WithNames({ children }: { children: (a: Names["clients"]) => ReactNode }) {
  const { data } = useData<Names>("clients?part=names");
  if (!data) return null;
  return data.clients.length === 0 ? <EmptyState title="No clients yet" body="Client accounts appear here once the first sync finishes." /> : <>{children(data.clients)}</>;
}

export function ClientsModule({ go, features = ALL_FEATURES, initialTab = "overview" }: { go: GoFn; features?: ClientsFeatures; initialTab?: "overview" | "onboarding" }) {
  const api = useApiClient(), sample = fixturesOn();
  const opt = useCl<Cl3Options>("options");
  const flags = (opt.data?.flags ?? null) as Record<string, boolean> | null;
  const [days, setDays] = useState<number>(30), [industry, setIndustry] = useState(""), [drill, setDrill] = useState<Drill>(null), [rev, setRev] = useState(0), [openId, setOpenId] = useState<string | null>(() => { try { const a = new URLSearchParams(window.location.search).get("account"); return a && /^[A-Za-z0-9_-]{3,128}$/.test(a) ? a : null; } catch { return null; } });
  const f = features, [since] = useState(() => Date.now());
  const on2 = (k: string) => flags?.[k] === true;
  const [acctPreset, setAcctPreset] = useState<Partial<AcctFilter> | null>(null);
  const tabs = useMemo(() => {
    const all: TabKey[] = ["overview", "money", "accounts", "plans", "needs", "trends", "compare", "reports", "proof", "people", "setup", "health"];
    const keep = all.filter((k) => (C2_FLAG_OF[k] ? flags?.[C2_FLAG_OF[k] as string] === true : k === "people" && flags?.cl2_team_move === true ? false : !FLAG_OF[k] || flags === null || flags[FLAG_OF[k] as string] !== false));
    return [...keep, ...(f.onboarding ? (["onboarding"] as TabKey[]) : []), ...(f.clients && f.reports ? (["reviews"] as TabKey[]) : []), ...(f.clients ? (["industries"] as TabKey[]) : [])];
  }, [flags, f.onboarding, f.clients, f.reports]);
  const [tab, setTab] = useState<TabKey>(initialTab);
  const filters = useMemo<ClParams>(() => {
    const from = new Date(since - days * 86_400_000).toISOString().slice(0, 10);
    return { from: days === 30 ? undefined : from, industry: industry || undefined };
  }, [days, industry, since]);
  const active = tabs.includes(tab) ? tab : tabs[0];
  const index = Math.max(0, tabs.indexOf(active));
  const open = (d: NonNullable<Drill>) => { setDrill(d); setTimeout(() => document.getElementById("cl-drill")?.scrollIntoView({ block: "nearest", behavior: "smooth" }), 50); };
  const goTab = (t: TabKey) => { setTab(t); setDrill(null); };
  const readsAccounts = !["onboarding", "reviews", "industries", "health", "accounts", "plans", "money", "proof"].includes(active);
  // A deep link (?account=<id>) opens that account's page. The server checks the id again; an id that is not yours shows "not found".
  const openAccount = (id: string | null) => { setOpenId(id); setDrill(null); try { const u = new URL(window.location.href); if (id) u.searchParams.set("account", id); else u.searchParams.delete("account"); window.history.replaceState(null, "", u.toString()); } catch { /* ignore */ } };
  const tileTo = (t: Cl2Today["tiles"][number]) => { setAcctPreset({ status: t.filter.status ?? "", level: t.filter.level ?? "", quiet: t.filter.quiet === true, plan: t.filter.plan ?? "" }); goTab("accounts"); };
  const buttonTo = (b: NonNullable<Cl2Today["button"]>) => { if (b.kind === "plans") goTab("plans"); else if (b.kind === "setup") goTab("setup"); else { setAcctPreset({ level: b.level ?? "", status: b.status ?? "" }); goTab("accounts"); } };
  const usesPeriod = ["overview", "needs", "trends", "compare", "people"].includes(active);

  if (openId && on2("cl2_account_page")) {
    return (
      <div className="s6 ap cl ds-enter" data-testid="page">
        <AccountPage key={openId} id={openId} onBack={() => openAccount(null)} flags={flags ?? {}} go={go} goTeam={(id) => go("team", id)} onDrill={(d) => { setDrill({ title: d.title, reason: d.reason as Cl3Reason, location: d.location, count: d.count }); setTimeout(() => document.getElementById("cl-drill")?.scrollIntoView({ block: "nearest", behavior: "smooth" }), 50); }}
          drill={drill ? <DrillList d={drill} filters={{}} onClose={() => setDrill(null)} openAccount={openAccount} /> : null}
          legacy={<ClientPage key={openId} id={openId} embedded onBack={() => openAccount(null)} onOpen={openAccount} go={go} />} />
      </div>
    );
  }
  if (openId) return <div className="s6 ap cl ds-enter" data-testid="page"><ClientPage key={openId} id={openId} onBack={() => openAccount(null)} onOpen={openAccount} go={go} /></div>;
  if (opt.data && opt.data.canSeeAccounts === false) return <Page title="Clients" subtitle="All your client accounts in one place." actions={null}><EmptyState title="Clients is for owners and admins" body="It shows every client account together. Ask the owner of your account to open it." /></Page>;

  const body = (() => {
    switch (active) {
      case "overview": return <Overview filters={filters} open={open} go={goTab} c2={on2("cl2_accounts")} onTile={tileTo} onButton={buttonTo} />;
      case "money": return <MoneyTab onOpen={openAccount} onPayments={(id) => go("payments" as never, id)} showApps={on2("cl3_apps")} showHistory={on2("cl3_history")} />;
      case "accounts": return <AccountsTab preset={acctPreset} onOpen={openAccount} go={(id) => go("team", id)} bulkOn={on2("cl2_bulk")} />;
      case "plans": return <PlansTab onOpen={openAccount} onPayments={(id) => go("payments" as never, id)} />;
      case "needs": return <Needs filters={filters} open={open} rev={rev} bump={() => setRev((n) => n + 1)} openClient={openAccount} />;
      case "trends": return <Trends filters={filters} />;
      case "compare": return <Compare options={opt.data ?? null} filters={filters} />;
      case "proof": return <ProofTab flags={flags ?? {}} />;
      case "reports": return <Reports filters={filters} onChanged={() => setRev((n) => n + 1)} />;
      case "people": return <People filters={filters} />;
      case "setup": return <Setup filters={filters} billingOn={(flags === null || flags.cl_billing !== false) && !on2("cl2_plans")} />;
      case "health": return <Health />;
      case "onboarding": return <OnboardingTab go={go} />;
      case "reviews": return <WithNames>{(a) => <ReviewsTab accounts={a} />}</WithNames>;
      case "industries": return <IndustriesTab go={go} showPlaybooks={f.playbooks} />;
    }
  })();
  return (
    <div className="s6 ap cl ds-enter" data-testid="cl-module">
      <Page title="Clients" subtitle="Which client accounts are fine, which need you, and proof to show them." actions={sample ? null : <Btn onClick={() => api.download("clients3?part=export", "clients.csv")}>Export CSV</Btn>}>
        {sample && <p className="ap-fine mb-2" role="status" data-testid="cl-sample">Sample data: these are not your real clients.</p>}
        {opt.data?.problem && <p className="ap-fine mb-2" role="status">{opt.data.problem}</p>}
        <ModuleTabs pill label="Clients sections" tabs={tabs.map((k) => ({ label: TIPS[k][0], tip: TIPS[k][1], node: null }))} value={index} onChange={(i) => goTab(tabs[i])} />
        {readsAccounts && (
          <div className="ap-head print:hidden" role="group" aria-label="Filters">
            {usesPeriod && <select className="ap-field" aria-label="Period" value={days} onChange={(e) => setDays(Number(e.target.value))}>{PERIODS.map(([d, l]) => <option key={d} value={d}>{l}</option>)}</select>}
            {(opt.data?.industries.length ?? 0) > 0 && <select className="ap-field" aria-label="Industry" value={industry} onChange={(e) => setIndustry(e.target.value)}><option value="">All industries</option>{opt.data?.industries.map((i) => <option key={i} value={i}>{i}</option>)}</select>}
            <span className="ap-fine">Every number below follows these choices{opt.data?.generatedAt ? `. Updated ${day(opt.data.generatedAt)}` : ""}.</span>
          </div>
        )}
        <div data-testid={`cl-tab-${active}`}>{body}</div>
        {drill && readsAccounts && <DrillList d={drill} filters={filters} onClose={() => setDrill(null)} openAccount={setOpenId} />}
      </Page>
    </div>
  );
}
