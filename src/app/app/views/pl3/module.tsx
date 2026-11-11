"use client";

import { Bookmark, Search, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PlDeal } from "@/lib/analytics/pipeline3-types-interim";
import { ModuleTabs, Page } from "../../ds";
import "../speed6.css";
import "../speed-ui.css";
import "../ap3/ap3.css";
import "./pl3.css";
import { useMountDealActions } from "./actions";
import { DEFAULT_FILTERS, fixturesOn, usePl, type PlFilters } from "./data";
import { MoneyFlow, type FlowPick } from "./money-flow";
import { DealList, DealPanel } from "./parts";
import { PipelineGrid, PipelinePicker } from "./pipes";
import type { PipeCard } from "@/lib/analytics/pipeline3-types";
import { Health, NeedsAttention, Overview, People, Proof, Sources, StageHistory, WonLost, type SectionProps } from "./sections";
import type { PlHealthRow } from "@/lib/analytics/pipeline3-types-interim";
import { SlippingPanel, useCashFlags } from "../td3/cash";

// Pipeline as a module with sub-sections (the Appointments pattern): Overview | Money Flow | Needs attention | Won and lost | People | Sources | Stage history | Health | Proof.
// One filter bar, one right-side deal panel, saved views and keys. SubSync never changes a deal from here; edits go through slice PB's checked gateway tools, which mount into the panel slots.

type TabKey = "overview" | "flow" | "needs" | "wonlost" | "people" | "sources" | "history" | "health" | "proof" | "slipping";
const TABS: Array<{ key: TabKey; label: string; tip: string }> = [
  { key: "overview", label: "Overview", tip: "The one sentence, the numbers and where the money leaks." }, { key: "flow", label: "Money flow", tip: "The money in each stage as stacks of coins." },
  { key: "needs", label: "Needs attention", tip: "Deals stuck longer than that step normally takes." }, { key: "wonlost", label: "Won and lost", tip: "What closed, and the lost reason when your CRM has one." },
  { key: "people", label: "People", tip: "Who closes and who lets deals go cold." },
  { key: "sources", label: "Sources", tip: "Which lead sources turn into money." }, { key: "history", label: "Stage history", tip: "How long deals really stay in each step." },
  { key: "health", label: "Accounts", tip: "Every client account, most stuck deals first." }, { key: "proof", label: "Proof", tip: "The weekly receipt per client." },
  { key: "slipping", label: "Slipping", tip: "Deals going quiet for their stage, about to, or lost this fortnight, with the money behind them." },
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
  const tabs = useMemo(() => TABS.filter((t) => (moneyFlow || t.key !== "flow") && (slippingOn || t.key !== "slipping")), [moneyFlow, slippingOn]);
  const [tab, setTab] = useState<TabKey>("overview");
  const [filters, setFilters] = useState<PlFilters>(DEFAULT_FILTERS);
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
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "/") { e.preventDefault(); search.current?.focus(); } else if (/^[1-9]$/.test(e.key) && tabs[Number(e.key) - 1]) setTab(tabs[Number(e.key) - 1].key);
    };
    window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k);
  }, [tabs]);

  const openDrill = (d: { title: string; count: number; extra: Record<string, string | number | undefined> }) => { setDrill({ ...d, tab }); setTimeout(() => document.getElementById("pl-drill")?.scrollIntoView({ block: "nearest", behavior: "smooth" }), 60); };
  const onPick = (p: FlowPick) => openDrill({ title: p.title, count: p.count, extra: { stage: p.params.stageId, stale: p.params.stale ? 1 : undefined, status: p.params.status ?? "open", reason: p.params.lostReason, owner: p.params.ownerId, expect: p.count } });
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
        : <PipelineGrid filters={filters} onOpen={openCard} />;
      case "needs": return <NeedsAttention {...sp} />;
      case "wonlost": return <><WonLost {...sp} />{drillList}</>;
      case "people": return <><People {...sp} />{drillList}</>;
      case "sources": return <><Sources {...sp} />{drillList}</>;
      case "history": return <StageHistory {...sp} />;
      case "health": return <><Health {...sp} />{drillList}</>;
      case "proof": return <><Proof {...sp} />{drillList}</>;
      case "slipping": return <SlippingPanel location={filters.locationId} showAccount={showAccount} />;
    }
  })();

  return (
    <div className="s6 ap pl ds-enter" ref={top} data-testid="pl-module" key={version}>
      <Page title="Pipeline" subtitle="Where your deal money sits, and what is stuck." actions={null}>
        <div className="ap-head" role="search" aria-label="Filter deals">
          <label className="ap-search"><Search aria-hidden className="size-4" /><span className="sr-only">Search by deal or contact</span><input ref={search} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a deal (press /)" data-testid="pl-search" /></label>
          <select className="ap-field" aria-label="Dates" value={filters.days} onChange={(e) => setFilters({ ...filters, days: Number(e.target.value) as PlFilters["days"] })} data-testid="pl-days"><option value={30}>Last 30 days</option><option value={45}>Last 45 days</option><option value={90}>Last 90 days</option></select>
          {accounts.length > 1 && <select className="ap-field" aria-label="Account" value={filters.locationId} onChange={(e) => { setPicked(null); setFilters({ ...filters, locationId: e.target.value, pipeline: "" }); }} data-testid="pl-account"><option value="">All accounts</option>{accounts.map((a) => <option key={a.locationId} value={a.locationId}>{a.name}</option>)}</select>}
          {moneyFlow && <PipelinePicker filters={filters} value={picked} onPick={openCard} onClear={() => { setPicked(null); setFilters((f) => ({ ...f, pipeline: "" })); }} />}
          <select className="ap-field" aria-label="Saved views" value="" onChange={(e) => applyView(Number(e.target.value))} data-testid="pl-views"><option value="" disabled>Saved views{views.length ? ` (${views.length})` : ""}</option>{views.map((v, i) => <option key={v.name} value={i}>{v.name}</option>)}</select>
          {naming ? <NameView onSave={saveView} onCancel={() => setNaming(false)} /> : <button type="button" className="s6-btn" onClick={() => setNaming(true)} data-testid="pl-save-view"><Bookmark aria-hidden className="size-4" />Save view</button>}
          {(filters.locationId || filters.q) && <button type="button" className="s6-btn" onClick={() => { setFilters(DEFAULT_FILTERS); setQ(""); }}><X aria-hidden className="size-4" />Clear</button>}
        </div>
        {fixturesOn() && <p className="ap-fine mb-2" role="status">Sample data: these are not your real deals.</p>}
        <ModuleTabs pill label="Pipeline sections" tabs={tabs.map((t) => ({ label: t.label, tip: t.tip, node: null }))} value={index < 0 ? 0 : index} onChange={(i) => { setTab(tabs[i].key); setDrill(null); }} />
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
