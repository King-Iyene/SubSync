"use client";

import { Search } from "lucide-react";
import { useEffect, useState } from "react";
import type { PipeCard, Pl3Cards } from "@/lib/analytics/pipeline3-types";
import { EmptyState, ErrorState, SkeletonRows } from "../../ds";
import { usePl, type PlFilters } from "./data";
import { money, moneyShort } from "./format";

// PIPELINE CARDS: when no single pipeline is picked, one small card per (account, pipeline), ranked by open money. Only stage-independent numbers are shown (open, won, lost money,
// counts, stuck, no owner), so stages of different pipelines are never mixed. The mini stack is that pipeline's own stages, left to right. Click a card for its coin stacks.
// Paged with a keyset cursor ("Show more"), searchable, empty pipelines hidden with a count. Cards are content-visibility:auto, so hundreds stay cheap.
const d = (v: number) => money(v * 100), ds = (v: number) => moneyShort(v * 100);

export function MiniStack({ stages }: { stages: PipeCard["mini"] }) {
  const max = Math.max(1, ...stages.map((s) => s.value));
  if (!stages.length) return <div className="pl-mini pl-mini-none" aria-hidden />;
  const w = 100 / stages.length;
  return (
    <svg className="pl-mini" viewBox="0 0 100 24" preserveAspectRatio="none" role="img" aria-label={`Open money by stage: ${stages.map((s) => `${s.name} ${ds(s.value)}`).join(", ")}`}>
      {stages.map((s, i) => { const h = s.value > 0 ? Math.max(2, (s.value / max) * 22) : 0.8; return <rect key={i} x={i * w + w * 0.14} y={24 - h} width={w * 0.72} height={h} rx={1} className={s.name === "Other stage" ? "pl-mini-other" : "pl-mini-bar"}><title>{`${s.name}: ${d(s.value)}`}</title></rect>; })}
    </svg>
  );
}

function CardView({ c, onOpen }: { c: PipeCard; onOpen: (c: PipeCard) => void }) {
  return (
    <li className="pl-pcard-li">
      <button type="button" className="pl-pcard" onClick={() => onOpen(c)} data-testid="pl-pcard" aria-label={`${c.accountName}, ${c.name}: ${d(c.openValue)} open${c.zeroValueCount > 0 ? `, ${c.zeroValueCount} deals without a value, not counted in money` : ""}. Open its stacks.`}>
        <span className="pl-pcard-name" title={c.name}>{c.name}</span>
        <span className="pl-pcard-acct" title={c.accountName}>{c.accountName}</span>
        <span className="pl-pcard-open tnum">{d(c.openValue)}<small> open · {c.openCount.toLocaleString("en-US")} deals{c.zeroValueCount > 0 && ` · ${c.zeroValueCount.toLocaleString("en-US")} ${c.zeroValueCount === 1 ? "deal" : "deals"} without a value (not counted in money)`}</small></span>
        <MiniStack stages={c.mini} />
        <span className="pl-pcard-foot tnum">
          <span>Won {ds(c.wonValue)}</span>
          <span>{c.staleCount > 0 ? <u>{c.staleCount.toLocaleString("en-US")} stuck</u> : "None stuck"}</span>
          {c.noOwnerCount > 0 && <span>{c.noOwnerCount.toLocaleString("en-US")} no owner</span>}
          {c.outlierCount > 0 && <span title="One deal over 40% of the account is shown apart, not added to open money">{c.outlierCount} big deal{c.outlierCount === 1 ? "" : "s"} apart ({ds(c.outlierValue)})</span>}
        </span>
      </button>
    </li>
  );
}

function Page({ filters, after, showEmpty, onOpen, onMore, first }: { filters: PlFilters; after: string | null; showEmpty: boolean; onOpen: (c: PipeCard) => void; onMore: (next: string) => void; first: boolean }) {
  const r = usePl<Pl3Cards>("pipelines", filters, { after: after ?? undefined, empty: showEmpty ? 1 : undefined, pageSize: 24 });
  // One account with one pipeline: no grid is needed, open it.
  const only = r.data && first && filters.locationId && !r.data.next && r.data.cards.length === 1 ? r.data.cards[0] : null;
  useEffect(() => { if (only) onOpen(only); }, [only, onOpen]);
  if (r.error) return <ErrorState error={r.error} onRetry={r.reload} />;
  if (!r.data) return <SkeletonRows rows={3} label="Loading pipelines..." />;
  return (
    <>
      <ul className="pl-pgrid">{r.data.cards.map((c) => <CardView key={`${c.locationId}|${c.pipelineId}`} c={c} onOpen={onOpen} />)}</ul>
      {r.data.next && <button type="button" className="s6-btn mt-3" onClick={() => onMore(r.data!.next!)} data-testid="pl-more">Show more pipelines</button>}
    </>
  );
}

export function PipelineGrid({ filters, onOpen }: { filters: PlFilters; onOpen: (c: PipeCard) => void }) {
  const [search, setSearch] = useState(""), [q, setQ] = useState(""), [showEmpty, setShowEmpty] = useState(false), [cursors, setCursors] = useState<string[]>([]);
  useEffect(() => { const t = setTimeout(() => { setQ(search.trim()); setCursors([]); }, 300); return () => clearTimeout(t); }, [search]);
  const f = { ...filters, q, pipeline: "" };
  const head = usePl<Pl3Cards>("pipelines", f, { empty: showEmpty ? 1 : undefined, pageSize: 24 });
  const t = head.data?.totals;
  if (head.error) return <ErrorState error={head.error} onRetry={head.reload} />;
  if (!head.data) return <SkeletonRows rows={4} label="Loading pipelines..." />;
  if (!head.data.cards.length && !t?.emptyHidden && !q) return <EmptyState title="No pipelines with deals yet" body="When a pipeline has deals, it shows here as a card. Click a card to see the money in each of its stages." />;
  return (
    <div data-testid="pl-grid">
      <div className="pl-gridbar">
        <label className="ap-search"><Search aria-hidden className="size-4" /><span className="sr-only">Search pipelines and accounts</span><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search pipelines or accounts" data-testid="pl-psearch" /></label>
        {t && <p className="ap-fine tnum" data-testid="pl-ptotals">{t.pipelines.toLocaleString("en-US")} pipelines · {d(t.openValue)} open · {d(t.wonValue)} won · {d(t.lostValue)} lost · {t.staleCount.toLocaleString("en-US")} stuck · {t.noOwnerCount.toLocaleString("en-US")} with no owner</p>}
      </div>
      <p className="ap-fine mb-2">Ranked by open money. Each pipeline has its own stages, so they are not added together here. Open money leaves out deals with no value, no owner, test deals, and any one deal over 40% of an account (shown apart on the card). It is the same rule as the stacks. Click a card to see its stacks.</p>
      {!head.data.cards.length ? <p className="ap-fine" role="status">No pipeline matches &quot;{q}&quot;.</p> : (
        <>
          <Page key={`p0${q}${showEmpty}`} filters={f} after={null} showEmpty={showEmpty} onOpen={onOpen} onMore={(n) => setCursors((c) => [...c, n])} first />
          {cursors.map((cur, i) => i < cursors.length - 1 ? <Page key={cur} filters={f} after={cur} showEmpty={showEmpty} onOpen={onOpen} onMore={() => {}} first={false} /> : <Page key={cur} filters={f} after={cur} showEmpty={showEmpty} onOpen={onOpen} onMore={(n) => setCursors((c) => [...c, n])} first={false} />)}
        </>
      )}
      {t && t.emptyHidden > 0 && !showEmpty && <p className="ap-fine mt-3" data-testid="pl-empty-hidden">{t.emptyHidden.toLocaleString("en-US")} empty hidden. <button type="button" className="ap-link" onClick={() => { setShowEmpty(true); setCursors([]); }}>Show them</button></p>}
      {showEmpty && <p className="ap-fine mt-3"><button type="button" className="ap-link" onClick={() => { setShowEmpty(false); setCursors([]); }}>Hide empty pipelines</button></p>}
    </div>
  );
}

/** The picker next to the account picker: a search box over "Account / Pipeline" (one page of the ranked list at a time), plus "All pipelines". */
export function PipelinePicker({ filters, value, onPick, onClear }: { filters: PlFilters; value: { name: string; account: string } | null; onPick: (c: PipeCard) => void; onClear: () => void }) {
  const [open, setOpen] = useState(false), [text, setText] = useState(""), [q, setQ] = useState("");
  useEffect(() => { const t = setTimeout(() => setQ(text.trim()), 250); return () => clearTimeout(t); }, [text]);
  const r = usePl<Pl3Cards>("pipelines", { ...filters, q, pipeline: "" }, { pageSize: 24 });
  const label = value ? `${value.account} / ${value.name}` : "All pipelines";
  return (
    <div className="pl-picker">
      <button type="button" className="ap-field pl-picker-btn" onClick={() => setOpen((o) => !o)} aria-haspopup="listbox" aria-expanded={open} data-testid="pl-picker" title={label}><span>{label}</span></button>
      {open && (
        <div className="pl-picker-pop" role="listbox" aria-label="Pick a pipeline">
          <input autoFocus className="ap-field" value={text} onChange={(e) => setText(e.target.value)} placeholder="Search pipelines" aria-label="Search pipelines" />
          <button type="button" role="option" aria-selected={!value} className="pl-picker-opt" onClick={() => { onClear(); setOpen(false); }}>All pipelines</button>
          {(r.data?.cards ?? []).map((c) => <button key={`${c.locationId}|${c.pipelineId}`} type="button" role="option" aria-selected={value?.name === c.name && value.account === c.accountName} className="pl-picker-opt" onClick={() => { onPick(c); setOpen(false); }} title={`${c.accountName} / ${c.name}`}>{c.accountName} / {c.name}<small> {ds(c.openValue)}</small></button>)}
          {r.data?.next && <p className="ap-fine">More match: type to narrow the list.</p>}
        </div>
      )}
    </div>
  );
}
