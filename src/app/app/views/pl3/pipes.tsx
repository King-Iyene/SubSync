"use client";

import { Search } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { PipeCard, Pl3Cards } from "@/lib/analytics/pipeline3-types";
import { EmptyState, ErrorState, SkeletonRows } from "../../ds";
import { usePageRange } from "../../ds/page-range";
import { usePl, type PlFilters } from "./data";
import { money, moneyShort } from "./format";
import { PIPE_PAGE, pageProgress, rowNotes, testNamesNote } from "./pipe-list";

// PIPELINE LIST: when no single pipeline is picked, one calm row per (account, pipeline). Columns line up (name, open money with its stage shape, deals, stuck, won, lost) and a row opens that
// pipeline's river. Only stage-independent numbers are shown, so stages of different pipelines are never mixed. Paged with a keyset cursor: the rows of every page sit in one list and ONE
// "Show more pipelines" button stays below the last row ("Showing 12 of 22"). Open money is as of now; the dates apply to won and lost. Rows stack on a phone.
const d = (v: number) => money(v * 100), ds = (v: number) => moneyShort(v * 100), n = (v: number) => v.toLocaleString("en-US");

export function MiniStack({ stages }: { stages: PipeCard["mini"] }) {
  const max = Math.max(1, ...stages.map((s) => s.value));
  if (!stages.length || stages.every((s) => s.value <= 0)) return <span className="pl-mini pl-mini-none" aria-hidden />;
  const w = 100 / stages.length;
  return (
    <svg className="pl-mini" viewBox="0 0 100 24" preserveAspectRatio="none" role="img" aria-label={`Open money by stage: ${stages.map((s) => `${s.name} ${ds(s.value)}`).join(", ")}`}>
      {stages.map((s, i) => { const h = s.value > 0 ? Math.max(2, (s.value / max) * 22) : 0; return h > 0 ? <rect key={i} x={i * w + w * 0.14} y={24 - h} width={w * 0.72} height={h} rx={1} className={s.name === "Other stage" ? "pl-mini-other" : "pl-mini-bar"}><title>{`${s.name}: ${d(s.value)}`}</title></rect> : null; })}
    </svg>
  );
}

function RowView({ c, onOpen }: { c: PipeCard; onOpen: (c: PipeCard) => void }) {
  const notes = rowNotes(c);
  return (
    <li className="pl-row-li">
      <button type="button" className="pl-row" onClick={() => onOpen(c)} data-testid="pl-row" aria-label={`${c.accountName}, ${c.name}: ${d(c.openValue)} open, ${c.openCount} deals, ${c.staleCount} stuck, won ${d(c.wonValue)}, lost ${d(c.lostValue)}${notes.length ? `. ${notes.join(". ")}` : ""}. Open its river.`}>
        <span className="pl-c-name"><b title={c.name}>{c.name}</b><span className="pl-c-acct" title={c.accountName}>{c.accountName}</span>{c.empty ? <span className="pl-c-note">Nothing in this pipeline yet.</span> : notes.length > 0 && <span className="pl-c-note">{notes.join(" · ")}</span>}</span>
        {c.empty ? null : (<>
          <span className="pl-c pl-c-open tnum" data-label="Open money"><b>{d(c.openValue)}</b><MiniStack stages={c.mini} /></span>
          <span className="pl-c tnum" data-label="Deals">{n(c.openCount)}</span>
          <span className="pl-c tnum" data-label="Stuck">{c.staleCount > 0 ? <u>{n(c.staleCount)}</u> : <span className="pl-c-dim">None</span>}</span>
          <span className="pl-c tnum" data-label="Won">{c.wonCount > 0 ? <>{ds(c.wonValue)}<small> · {n(c.wonCount)}</small></> : <span className="pl-c-dim">None</span>}</span>
          <span className="pl-c tnum" data-label="Lost">{c.lostCount > 0 ? <>{ds(c.lostValue)}<small> · {n(c.lostCount)}</small></> : <span className="pl-c-dim">None</span>}</span>
        </>)}
      </button>
    </li>
  );
}

function Page({ filters, after, showEmpty, dir, onOpen, onLoaded, first }: { filters: PlFilters; after: string | null; showEmpty: boolean; dir: "asc" | "desc"; onOpen: (c: PipeCard) => void; onLoaded: (cursor: string, count: number, next: string | null) => void; first: boolean }) {
  const r = usePl<Pl3Cards>("pipelines", filters, { after: after ?? undefined, empty: showEmpty ? 1 : undefined, pageSize: PIPE_PAGE, dir: dir === "asc" ? "asc" : undefined });
  const data = r.data;
  // One account with one pipeline: no list is needed, open it.
  const only = data && first && filters.locationId && !data.next && data.cards.length === 1 ? data.cards[0] : null;
  useEffect(() => { if (only) onOpen(only); }, [only, onOpen]);
  useEffect(() => { if (data) onLoaded(after ?? "", data.cards.length, data.next); }, [data, after, onLoaded]);
  if (r.error) return <li className="pl-row-li"><ErrorState error={r.error} onRetry={r.reload} /></li>;
  if (!data) return <li className="pl-row-li"><SkeletonRows rows={3} label="Loading pipelines..." /></li>;
  return <>{data.cards.map((c) => <RowView key={`${c.locationId}|${c.pipelineId}`} c={c} onOpen={onOpen} />)}</>;
}

export function PipelineGrid({ filters, onOpen, onIncludeTest }: { filters: PlFilters; onOpen: (c: PipeCard) => void; onIncludeTest?: (v: boolean) => void }) {
  const range = usePageRange();
  const [search, setSearch] = useState(""), [q, setQ] = useState(""), [showEmpty, setShowEmpty] = useState(false), [dir, setDir] = useState<"asc" | "desc">("desc");
  useEffect(() => { const t = setTimeout(() => setQ(search.trim()), 300); return () => clearTimeout(t); }, [search]);
  const f = { ...filters, q, pipeline: "" };
  // Everything the rows depend on. When it changes the pages start over (an old cursor never meets new dates).
  const rk = [q, showEmpty, dir, f.includeTest ? 1 : 0, f.from, f.to, f.days, f.locationId].join("|");
  const [more, setMore] = useState<{ rk: string; list: string[] }>({ rk: "", list: [] });
  const cursors = more.rk === rk ? more.list : [];
  const [loaded, setLoaded] = useState<Record<string, { n: number; next: string | null }>>({});
  const onLoaded = useCallback((cur: string, count: number, next: string | null) => setLoaded((s) => (s[`${rk}#${cur}`]?.n === count && s[`${rk}#${cur}`]?.next === next ? s : { ...s, [`${rk}#${cur}`]: { n: count, next } })), [rk]);
  const head = usePl<Pl3Cards>("pipelines", f, { empty: showEmpty ? 1 : undefined, pageSize: PIPE_PAGE, dir: dir === "asc" ? "asc" : undefined });
  const t = head.data?.totals;
  if (head.error) return <ErrorState error={head.error} onRetry={head.reload} />;
  if (!head.data) return <SkeletonRows rows={4} label="Loading pipelines..." />;
  if (!head.data.cards.length && !t?.emptyHidden && !q && !t?.testCount) return <EmptyState title="No pipelines with deals yet" body="When a pipeline has deals, it shows here as a row. Click a row to see the money in each of its stages." />;
  const total = t ? (showEmpty ? t.all ?? t.pipelines : t.pipelines) : 0, prog = pageProgress(loaded, rk, cursors, total), next = prog.next, loadingTail = prog.loading;
  const note = testNamesNote(t);
  return (
    <div data-testid="pl-grid">
      <div className="pl-gridbar">
        <label className="ap-search"><Search aria-hidden className="size-4" /><span className="sr-only">Search pipelines and accounts</span><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search pipelines or accounts" data-testid="pl-psearch" /></label>
        {t && <p className="ap-fine tnum" data-testid="pl-ptotals">{n(t.pipelines)} pipelines · {d(t.openValue)} open · {d(t.wonValue)} won · {d(t.lostValue)} lost · {n(t.staleCount)} stuck · {n(t.noOwnerCount)} with no owner</p>}
      </div>
      <p className="ap-fine mb-1" data-testid="pl-asof"><b>Open money is as of now.</b> The dates{range.label ? ` (${range.label})` : ""} apply to won and lost.</p>
      <p className="ap-fine mb-2">Each pipeline has its own stages, so they are not added together. Open money leaves out deals with no value, no owner, test deals, and any one deal over 40% of an account. It is the same rule as the river. Click a row to open it.</p>
      {note && <p className="ap-fine mb-2" data-testid="pl-testnames" role="status">{note.text}{note.action && onIncludeTest && <>{" "}<button type="button" className="ap-link" onClick={() => onIncludeTest(note.action === "count")} data-testid="pl-testnames-toggle">{note.action === "count" ? "Count them" : "Leave them out"}</button></>}</p>}
      {!head.data.cards.length ? <p className="ap-fine" role="status">{q ? `No pipeline matches "${q}".` : "Nothing to list here yet."}</p> : (
        <div className="pl-list" role="group" aria-label="Pipelines">
          <div className="pl-row pl-row-head">
            <span className="pl-c-name">Pipeline</span>
            <span className="pl-c pl-c-open"><button type="button" className="pl-sort" onClick={() => setDir((x) => (x === "desc" ? "asc" : "desc"))} aria-label={`Open money, sorted ${dir === "desc" ? "biggest" : "smallest"} first. Press to reverse.`} data-testid="pl-sort">Open money <span aria-hidden>{dir === "desc" ? "↓" : "↑"}</span></button></span>
            <span className="pl-c">Deals</span><span className="pl-c">Stuck</span><span className="pl-c">Won</span><span className="pl-c">Lost</span>
          </div>
          <ul className="pl-rows">
            <Page key={`p0${rk}`} filters={f} after={null} showEmpty={showEmpty} dir={dir} onOpen={onOpen} onLoaded={onLoaded} first />
            {cursors.map((cur) => <Page key={`${rk}${cur}`} filters={f} after={cur} showEmpty={showEmpty} dir={dir} onOpen={onOpen} onLoaded={onLoaded} first={false} />)}
          </ul>
          <div className="pl-more" data-testid="pl-more-bar">
            <span className="ap-fine tnum" data-testid="pl-showing" role="status">{prog.label}</span>
            {next && <button type="button" className="s6-btn" disabled={loadingTail} onClick={() => setMore({ rk, list: [...cursors, next] })} data-testid="pl-more">{loadingTail ? "Loading..." : "Show more pipelines"}</button>}
          </div>
        </div>
      )}
      {t && t.emptyHidden > 0 && !showEmpty && <p className="ap-fine mt-3" data-testid="pl-empty-hidden">{n(t.emptyHidden)} empty hidden. <button type="button" className="ap-link" onClick={() => setShowEmpty(true)}>Show them</button></p>}
      {showEmpty && <p className="ap-fine mt-3"><button type="button" className="ap-link" onClick={() => setShowEmpty(false)}>Hide empty pipelines</button></p>}
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
