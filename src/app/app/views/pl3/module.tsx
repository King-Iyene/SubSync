"use client";

import { zoneWord } from "@/lib/design/zone";
import { hotkeyIgnored } from "@/lib/design/ui-logic";
import { usePageRange } from "../../ds/page-range";
import { Bookmark, Search, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { takeDeepLink } from "@/lib/design/deep-link";
import type { PlDeal } from "@/lib/analytics/pipeline3-types-interim";
import { GroupedTabs, Page } from "../../ds";
import "../speed6.css";
import "../speed-ui.css";
import "../ap3/ap3.css";
import "./pl3.css";
import { useMountDealActions } from "./actions";
import { DEFAULT_FILTERS, fixturesOn, usePl, type PlFilters } from "./data";
import { HistoryFunnel, StuckInStep, useHistoryFunnelOn } from "./history-funnel";
import { MoneyFlow, type FlowPick } from "./money-flow";
import { DealList, DealPanel } from "./parts";
import { PipelineGrid, PipelinePicker } from "./pipes";
import type { PipeCard } from "@/lib/analytics/pipeline3-types";
import { Health, NeedsAttention, Overview, People, Proof, Sources, StageHistory, WonLost, type SectionProps } from "./sections";
import type { PlHealthRow } from "@/lib/analytics/pipeline3-types-interim";
import { SlippingPanel, useCashFlags } from "../td3/cash";
import { PipelineView } from "../pipeline";
import { DealsView } from "../deals";
import { DealMoves } from "../people";

// Pipeline as a module with sub-sections (the Appointments pattern): Overview | Money Flow | Needs attention | Won and lost | People | Sources | Stage history | Health | Proof.
// One filter bar, one right-side deal panel, saved views and keys. SubSync never changes a deal from here; edits go through slice PB's checked gateway tools, which mount into the panel slots.

type TabKey = "overview" | "flow" | "needs" | "wonlost" | "people" | "sources" | "history" | "health" | "proof" | "slipping" | "classic" | "stale" | "funnel" | "stuck";
const TABS: Array<{ key: TabKey; label: string; tip: string }> = [
  { key: "overview", label: "Overview", tip: "The one sentence, the numbers and where the money leaks." }, { key: "flow", label: "Money flow", tip: "Deals and money flowing through each stage, where they pile up, get stuck or leak." },
  { key: "needs", label: "Needs attention", tip: "Deals stuck longer than that step normally takes." }, { key: "wonlost", label: "Won and lost", tip: "What closed, and the lost reason when your CRM has one." },
  { key: "people", label: "People", tip: "Who closes and who lets deals go cold." },
  { key: "sources", label: "Sources", tip: "Which lead sources turn into money." }, { key: "history", label: "Stage history", tip: "How long deals really stay in each step." },
  { key: "health", label: "Accounts", tip: "Every client account, most stuck deals first." }, { key: "proof", label: "Proof", tip: "The weekly receipt per client." },
  { key: "funnel", label: "Step history", tip: "How many deals entered each step, how many moved on, and how long they stayed, from the moves SubSync recorded." },
  { key: "stuck", label: "Stuck in a step", tip: "Open deals past the usual time for their own step, biggest money first." },
  { key: "slipping", label: "Slipping", tip: "Deals going quiet for their stage, about to, or lost this fortnight, with the money behind them." },
  // Restored from the earlier Pipeline (a revamp adds, never removes): the forecast, coverage, bottleneck and risk cards, and the stale-deal list with its export.
  { key: "classic", label: "Forecast and stages", tip: "Forecast, coverage, bottlenecks, deal risk, aging, wins and losses by month, and the export of open deals." },
  { key: "stale", label: "Stale deals and hygiene", tip: "Open deals that have not moved, by stage, with the CSV export." },
];
// Grouped under plain names; every page is in a group and none is removed.
const PL_GROUPS = [
  { label: "Overview", tip: "The one sentence and what needs you.", keys: ["overview", "needs", "slipping", "stuck", "stale"] },
  { label: "Money and forecast", tip: "Where the money sits, what closed and the forecast.", keys: ["flow", "wonlost", "sources", "classic"] },
  { label: "Stage history", tip: "How deals moved and how long they stayed.", keys: ["history", "funnel"] },
  { label: "People and accounts", tip: "Who closes and which client accounts have stuck deals.", keys: ["people", "health"] },
  { label: "Proof", tip: "The weekly receipt per client.", keys: ["proof"] },
];
type SavedView = { name: string; filters: PlFilters; tab: TabKey };
const VIEWS_KEY = "pl3.views.v1";
const readViews = (): SavedView[] => { try { const v = JSON.parse(localStorage.getItem(VIEWS_KEY) ?? "[]"); return Array.isArray(v) ? v.slice(0, 20) : []; } catch { return []; } };
const writeViews = (v: SavedView[]) => { try { localStorage.setItem(VIEWS_KEY, JSON.stringify(v)); } catch { /* private mode: the view simply is not kept */ } };
type Drill = { tab: TabKey; title: string; count: number; extra: Record<string, string | number | undefined> } | null;

export function PipelineModule({ moneyFlow = true, actions = false }: { moneyFlow?: boolean; actions?: boolean }) {
  useMountDealActions(actions);
  const cash = useCashFlags();
  const slippingOn = cash.flags?.cf_deals === true;
  const funnelOn = useHistoryFunnelOn();
  const tabs = useMemo(() => TABS.filter((t) => (moneyFlow || t.key !== "flow") && (slippingOn || t.key !== "slipping") && (funnelOn || (t.key !== "funnel" && t.key !== "stuck"))), [moneyFlow, slippingOn, funnelOn]);
  const [tab, setTab] = useState<TabKey>("overview");
  // A click from the Today "Money at risk" card opens the quiet-deals section (see deep-link.ts).
  const arrived = useRef(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (arrived.current) return; const dl = takeDeepLink("pipeline"); if (!dl) return; arrived.current = true; if (tabs.some((t) => t.key === dl.tab)) setTab(dl.tab as TabKey); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // The dates are the date bar's (one range for the whole app). What this screen keeps is the account, pipeline, owner and search; the dates are laid over them.
  const bar = usePageRange();
  const [picks, setFilters] = useState<PlFilters>(DEFAULT_FILTERS);
  const filters = useMemo<PlFilters>(() => ({ ...picks, from: bar.ready ? bar.from : undefined, to: bar.ready ? bar.to : undefined, fromTime: bar.ready && bar.timed ? bar.fromTime : undefined, toTime: bar.ready && bar.timed ? bar.toTime : undefined }), [picks, bar.ready, bar.from, bar.to, bar.timed, bar.fromTime, bar.toTime]);
  const [q, setQ] = useState("");
  const [deal, setDeal] = useState<PlDeal | null>(null);
  const [drill, setDrill] = useState<Drill>(null);
  const [views, setViews] = useState<SavedView[]>([]);
  const [naming, setNaming] = useState(false);
  const [picked, setPicked] = useState<{ name: string; account: string } | null>(null);
  const openCard = useCallback((c: PipeCard) => { setPicked({ name: c.name, account: c.accountName }); setDrill(null); setFilters((f) => ({ ...f, locationId: c.locationId, pipeline: c.name })); }, []);
  const [version, setVersion] = useState(0);
  const search = useRef<HTMLInputElement>(null), top = useRef<HTMLDivElement>(null);
  const health = usePl<{ rows: PlHealthRow[] }>("accounts", { ...filters, locationId: "" });
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setViews(readViews()); }, []);
  useEffect(() => { const t = setTimeout(() => setFilters((f) => (f.q === q ? f : { ...f, q })), 300); return () => clearTimeout(t); }, [q]);

  const index = tabs.findIndex((t) => t.key === tab);
  const goTab = useCallback((k: string) => { setTab(k as TabKey); setDrill(null); top.current?.scrollIntoView({ block: "start", behavior: "smooth" }); }, []);
  const accounts = Array.isArray(health.data?.rows) ? health.data.rows : [];
  const showAccount = !filters.locationId && (accounts.length || 2) > 1;
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (hotkeyIgnored(e) || document.querySelector("[data-testid=lead-drawer-root]")) return;
      if (e.key === "/") { e.preventDefault(); search.current?.focus(); } else if (/^[1-9]$/.test(e.key) && tabs[Number(e.key) - 1]) setTab(tabs[Number(e.key) - 1].key);
    };
    window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k);
  }, [tabs]);

  const openDrill = (d: { title: string; count: number; extra: Record<string, string | number | undefined> }) => { setDrill({ ...d, tab }); setTimeout(() => document.getElementById("pl-drill")?.scrollIntoView({ block: "nearest", behavior: "smooth" }), 60); };
  const onPick = (p: FlowPick) => openDrill({ title: p.title, count: p.count, extra: { stage: p.params.stageId, bucket: p.params.bucket, stale: p.params.stale ? 1 : undefined, status: p.params.status ?? "open", reason: p.params.lostReason, owner: p.params.ownerId, expect: p.count } });
  const sp: SectionProps = { filters, onOpen: setDeal, activeId: deal?.id ?? null, showAccount, go: goTab, onDrill: openDrill };
  const saveView = (name: string) => { const next = [{ name: name.trim().slice(0, 40), filters, tab }, ...views.filter((v) => v.name !== name.trim())].slice(0, 20); setViews(next); writeViews(next); setNaming(false); };
  const applyView = (i: number) => { const v = views[i]; if (!v) return; setFilters(v.filters); setQ(v.filters.q); if (tabs.some((t) => t.key === v.tab)) setTab(v.tab); };

  const drillList = drill && drill.tab === tab ? (
    <div id="pl-drill" className="mt-5" data-testid="pl-drill">
      <div className="mb-2 flex flex-wrap items-center gap-3"><h3 className="text-base font-semibold" data-testid="pl-drill-title">{drill.title}</h3>{drill.count > 0 && <span className="ap-chip" data-tone="cyan">{drill.count.toLocaleString("en-US")}</span>}<button type="button" className="ap-link ml-auto" onClick={() => setDrill(null)}>Close list</button></div>
      <DealList filters={filters} extra={drill.extra} onOpen={setDeal} activeId={deal?.id ?? null} showAccount={showAccount} empty="Nothing behind this one in these dates." testId="pl-drill-list" />
    </div>
  ) : null;
  const content = (() => {
    switch (tab) {
      case "overview": return <><Overview {...sp} />{drillList}</>;
      case "flow": return filters.pipeline && filters.locationId
        ? <><p className="ap-fine mb-2"><button type="button" className="ap-link" onClick={() => { setPicked(null); setFilters((f) => ({ ...f, pipeline: "" })); }} data-testid="pl-allpipes">All pipelines</button>{picked ? ` / ${picked.account} / ${picked.name}` : ""}</p><MoneyFlow filters={filters} onPick={onPick} />{drillList}</>
        : <PipelineGrid filters={filters} onOpen={openCard} onIncludeTest={(v) => setFilters((f) => ({ ...f, includeTest: v }))} />;
      case "needs": return <NeedsAttention {...sp} />;
      case "wonlost": return <><WonLost {...sp} />{drillList}</>;
      case "people": return <><People {...sp} />{drillList}</>;
      case "sources": return <><Sources {...sp} />{drillList}</>;
      case "history": return <StageHistory {...sp} />;
      case "health": return <><Health {...sp} />{drillList}</>;
      case "proof": return <><Proof {...sp} />{drillList}</>;
      case "funnel": return <HistoryFunnel filters={filters} onOpen={setDeal} activeId={deal?.id ?? null} showAccount={showAccount} />;
      case "stuck": return <StuckInStep filters={filters} onOpen={setDeal} activeId={deal?.id ?? null} showAccount={showAccount} />;
      case "slipping": return <SlippingPanel location={filters.locationId} showAccount={showAccount} />;
      case "classic": return <div className="[&_h1]:sr-only"><PipelineView /><DealMoves /></div>;
      case "stale": return <div className="[&_h1]:sr-only"><DealsView /></div>;
    }
  })();

  return (
    <div className="s6 ap pl ds-enter" ref={top} data-testid="pl-module" key={version}>
      <Page title="Pipeline" subtitle="Where your deal money sits, and what is stuck." actions={<button type="button" className="s6-btn" onClick={() => { setTab("stale"); setDrill(null); }} data-testid="pl-export">Stale deals and CSV export</button>}>
        <div className="ap-head" role="search" aria-label="Filter deals" hidden={tab === "classic" || tab === "stale"}>
          <label className="ap-search"><Search aria-hidden className="size-4" /><span className="sr-only">Search by deal or contact</span><input ref={search} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a deal (press /)" data-testid="pl-search" /></label>
          <span className="ap-fine" data-testid="pl-days">Dates: {bar.label}, {zoneWord()} time, from the bar above. Open money, stuck and open counts are as of now.</span>
          {accounts.length > 1 && <select className="ap-field" aria-label="Account" value={filters.locationId} onChange={(e) => { setPicked(null); setFilters({ ...filters, locationId: e.target.value, pipeline: "" }); }} data-testid="pl-account"><option value="">All accounts</option>{accounts.map((a) => <option key={a.locationId} value={a.locationId}>{a.name}</option>)}</select>}
          {moneyFlow && <PipelinePicker filters={filters} value={picked} onPick={openCard} onClear={() => { setPicked(null); setFilters((f) => ({ ...f, pipeline: "" })); }} />}
          <select className="ap-field" aria-label="Saved views" value="" onChange={(e) => applyView(Number(e.target.value))} data-testid="pl-views"><option value="" disabled>Saved views{views.length ? ` (${views.length})` : ""}</option>{views.map((v, i) => <option key={v.name} value={i}>{v.name}</option>)}</select>
          {naming ? <NameView onSave={saveView} onCancel={() => setNaming(false)} /> : <button type="button" className="s6-btn" onClick={() => setNaming(true)} data-testid="pl-save-view"><Bookmark aria-hidden className="size-4" />Save view</button>}
          {(filters.locationId || filters.q) && <button type="button" className="s6-btn" onClick={() => { setFilters(DEFAULT_FILTERS); setQ(""); }}><X aria-hidden className="size-4" />Clear</button>}
        </div>
        {fixturesOn() && <p className="ap-fine mb-2" role="status">Sample data: these are not your real deals.</p>}
        <GroupedTabs testId="pl-groups" groups={PL_GROUPS} available={tabs.map((t) => t.key)} active={index < 0 ? tabs[0]?.key ?? "overview" : tab} labels={Object.fromEntries(tabs.map((t) => [t.key, t.label]))} tips={Object.fromEntries(tabs.map((t) => [t.key, t.tip]))} onSelect={(k) => { setTab(k as TabKey); setDrill(null); }} label="Pipeline sections" />
        <div data-testid={`pl-tab-${tab}`}>{content}</div>
        <p className="ap-fine mt-6">Keys: / search, 1 to 9 switch section, up and down move in a list, Enter opens, Esc closes. Nothing is ever deleted from a key.</p>
        {deal && <DealPanel deal={deal} onClose={() => setDeal(null)} onChanged={() => setVersion((v) => v + 1)} filters={filters} />}
      </Page>
    </div>
  );
}

function NameView({ onSave, onCancel }: { onSave: (n: string) => void; onCancel: () => void }) {
  const [n, setN] = useState("");
  return (
    <form className="inline-flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); if (n.trim()) onSave(n); }}>
      <input className="ap-field" autoFocus value={n} onChange={(e) => setN(e.target.value)} placeholder="Name this view" maxLength={40} aria-label="Name this view" onKeyDown={(e) => { if (e.key === "Escape") onCancel(); }} />
      <button type="submit" className="s6-btn" data-kind="primary" disabled={!n.trim()}>Save</button>
    </form>
  );
}
