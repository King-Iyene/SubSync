"use client";

import { ChevronDown, GitCompareArrows, Play, Sparkles } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { closerTotals, findLeak, layoutFlow, LEAF_ORDER, nextLead, OUTCOME_LABEL, OUTCOME_TONE, type FlowNode, type Tone } from "@/lib/design/appt-flow-layout";
import { coachingNote, money, pct } from "@/lib/design/appt-coach";
import { EmptyState, ErrorState, SkeletonRows } from "../../ds";
import { CountUp, useReducedMotion } from "../speed6-base";
import { useAp, type ApFilters } from "./data";
import { Chip } from "./parts";
import type { ApFlowTree, ApOutcome, ApStats } from "./types";

// The Appointment Flow Tree: a branching tree, not a river. Root = booked leads, branches = who booked (setter), then who took the meeting (closer), leaves = what happened.
// Width of a branch = number of appointments, colour = health against YOUR OWN averages, glow = best converters. Click anything to open exactly those appointments.

export type FlowPick = { title: string; count: number; params: { booker?: string; owner?: string; outcome?: ApOutcome } };
const TONE_TEXT: Record<Tone, string> = { green: "Healthy", amber: "Watch", red: "Leaking", grey: "Not enough data", cyan: "", violet: "" };
const LEGEND: Array<[Tone, string]> = [["green", "Healthy: shows and closes above your average"], ["amber", "Watch"], ["red", "Leaking: far below your average"], ["grey", "Not enough data"]];
const COLOR: Record<Tone, string> = { green: "var(--s6-green)", amber: "var(--s6-amber)", red: "var(--s6-red)", grey: "var(--muted-foreground)", cyan: "var(--s6-cyan)", violet: "var(--s6-violet)" };

function Stats({ s }: { s: ApStats }) {
  const cells: Array<[string, string]> = [["Booked", String(s.bookings)], ["Show", pct(s.showRate)], ["No-show", pct(s.noShowRate)], ["Close", pct(s.closeRate)], ["Burned", String(s.burned)], ["Won", money(s.revenueCents)]];
  return <div className="ap-stats">{cells.map(([l, v]) => <div className="ap-stat" key={l}><b>{v}</b><small>{l}</small></div>)}</div>;
}
const sentence = (n: FlowNode) => {
  if (n.kind === "root") return `${n.count} appointments booked. Open all of them.`;
  if (n.kind === "leaf") return `${n.count} ${OUTCOME_LABEL[n.outcome!].toLowerCase()} appointments, booked by ${n.setterId} and taken by ${n.closerId}.`;
  return `${n.label}: ${n.count} appointments, ${TONE_TEXT[n.tone].toLowerCase() || "overview"}.`;
};

export function FlowTree({ filters, onOpen, go }: { filters: ApFilters; onOpen: (p: FlowPick) => void; go?: (to: string) => void }) {
  const { data, error, loading, reload } = useAp<ApFlowTree>("flow-tree", filters);
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1000);
  const reduced = useReducedMotion();
  const [run, setRun] = useState(0);
  const [hot, setHot] = useState<string | null>(null);
  const [cmp, setCmp] = useState<string[]>([]);
  const [setterLimit, setSetterLimit] = useState(5);
  const [leakOn, setLeakOn] = useState(false);
  useEffect(() => {
    const el = wrap.current; if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.floor(el.clientWidth)));
    ro.observe(el); setWidth(Math.floor(el.clientWidth));
    return () => ro.disconnect();
  }, [data !== null && data.booked > 0]); // eslint-disable-line react-hooks/exhaustive-deps
  const tree = data;
  const layout = useMemo(() => (tree && width >= 700 ? layoutFlow(tree, { width: width - 18, maxSetters: setterLimit, maxClosers: 4 }) : null), [tree, width, setterLimit]);
  const leak = useMemo(() => (tree ? findLeak(tree) : null), [tree]);
  const next = useMemo(() => (tree ? nextLead(tree) : null), [tree]);
  const people = useMemo(() => {
    if (!tree) return new Map<string, ApStats & { name: string }>();
    const m = new Map<string, ApStats & { name: string }>();
    for (const s of tree.setters) m.set(`s:${s.id}`, s);
    for (const c of closerTotals(tree)) m.set(`k:${c.id}`, c);
    return m;
  }, [tree]);
  const hotSet = useMemo(() => {
    if (!hot || !layout) return null;
    const by = new Map(layout.nodes.map((n) => [n.id, n])); const set = new Set<string>();
    for (let n = by.get(hot); n; n = n.parent ? by.get(n.parent) : undefined) set.add(n.id);
    return set;
  }, [hot, layout]);

  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!tree) return <SkeletonRows rows={6} label="Growing the tree..." />;
  if (tree.booked === 0) return <EmptyState title="No bookings in these dates" body="When leads book, the tree grows here: who booked them, who took the meeting, and what happened. Try a longer period." />;

  const pick = (n: FlowNode) => {
    const setter = n.setterId, closer = n.closerId;
    const person = n.kind === "setter" ? people.get(`s:${setter}`) : n.kind === "closer" ? people.get(`k:${closer}`) : null;
    const who = n.kind === "root" ? "All booked appointments" : n.kind === "leaf" ? `${OUTCOME_LABEL[n.outcome!]}: ${setterName(setter)} to ${closerName(closer)}` : n.kind === "setter" ? `Booked by ${n.label}` : `${setterName(setter)} to ${n.label}`;
    void person;
    onOpen({ title: who, count: n.count, params: { booker: n.kind === "root" ? undefined : setter, owner: n.kind === "closer" || n.kind === "leaf" ? closer : undefined, outcome: n.outcome } });
  };
  const setterName = (id?: string) => tree.setters.find((s) => s.id === id)?.name ?? "";
  const closerName = (id?: string) => tree.setters.flatMap((s) => s.closers).find((c) => c.id === id)?.name ?? "";
  const toggleCmp = (n: FlowNode) => { const k = n.kind === "setter" ? `s:${n.setterId}` : `k:${n.closerId}`; setCmp((c) => (c.includes(k) ? c.filter((x) => x !== k) : [...c.slice(-1), k])); };
  const preview = hot && layout ? layout.nodes.find((n) => n.id === hot) : null;
  const showLeak = (leakNode: string) => { setLeakOn(true); setHot(leakNode); setTimeout(() => wrap.current?.querySelector<HTMLElement>(`[data-node="${CSS.escape(leakNode)}"] button`)?.scrollIntoView({ block: "center", behavior: reduced ? "auto" : "smooth" }), 50); };
  const cmpPeople = cmp.map((k) => ({ k, p: people.get(k) })).filter((x): x is { k: string; p: ApStats & { name: string } } => !!x.p);
  const hidden = tree.hiddenSetters + Math.max(0, tree.setters.length - setterLimit);

  return (
    <div data-testid="ap-flow" aria-busy={loading}>
      {leak ? (
        <div className="ap-leak" data-testid="ap-leak">
          <Sparkles aria-hidden className="size-4 text-[var(--s6-red)]" /><span><b>Biggest leak.</b> {leak.text} About {leak.excess} extra no-shows.</span>
          {width >= 700 ? <button type="button" className="s6-btn" onClick={() => showLeak(leak.nodeId)} data-testid="ap-leak-show">Show me</button> : <button type="button" className="s6-btn" onClick={() => onOpen({ title: `${setterName(leak.setterId)} to ${closerName(leak.closerId ?? "")}, no-shows`, count: leak.excess, params: { booker: leak.setterId, owner: leak.closerId ?? undefined, outcome: "noshow" } })}>Open them</button>}
        </div>
      ) : <div className="ap-leak" data-ok="1" data-testid="ap-leak"><Sparkles aria-hidden className="size-4 text-[var(--s6-green)]" /><span>No single hand-off stands out. Nobody is far above your own no-show rate.</span></div>}
      {next && (
        <div className="ap-fine mb-3" data-testid="ap-next-lead"><b className="text-foreground">Who should get the next lead? {next.name}.</b> {next.text} <i>Estimate, from your own results only.</i>{" "}
          <details className="inline"><summary className="ap-link inline cursor-pointer">How this is worked out</summary><span className="mt-1 block max-w-xl">Won appointments divided by appointments handed over, for each closer with at least {tree.minBookings} bookings. It ignores deal size and lead quality, so use it as a nudge.</span></details></div>
      )}

      <div className="ap-tree-bar">
        <div className="ap-legend" aria-label="Colour key">{LEGEND.map(([t, l]) => <span key={t}><i style={{ background: COLOR[t] }} />{l}</span>)}<span><Sparkles aria-hidden className="mr-1 inline size-3 text-[var(--s6-cyan)]" />Glow: best converters</span></div>
        <span className="ml-auto inline-flex flex-wrap gap-2">
          {layout && !reduced && <button type="button" className="s6-btn" onClick={() => setRun((r) => r + 1)} data-testid="ap-replay"><Play aria-hidden className="size-4" />Replay</button>}
          {tree.setters.length > 4 && <label className="sr-only" htmlFor="ap-limit">People shown</label>}
          {tree.setters.length > 4 && <select id="ap-limit" className="ap-field" value={setterLimit} onChange={(e) => setSetterLimit(Number(e.target.value))}><option value={4}>Top 4 bookers</option><option value={8}>Top 8 bookers</option><option value={100}>All bookers</option></select>}
        </span>
      </div>

      <div className="ap-preview" aria-live="polite" data-testid="ap-preview">
        {preview && preview.stats ? <><b>{preview.label}</b><span>{preview.stats.bookings} booked</span><span>{pct(preview.stats.showRate)} show</span><span>{pct(preview.stats.noShowRate)} no-show</span><span>{pct(preview.stats.closeRate)} close</span><span>{money(preview.stats.revenueCents)} won</span>{preview.stats.avgLeadToBookedHours !== null && <span>{preview.stats.avgLeadToBookedHours.toFixed(1)}h lead to booked</span>}<Chip tone={preview.tone}>{TONE_TEXT[preview.tone]}</Chip></>
          : preview ? <><b>{preview.label}</b><span>{preview.count} appointments. Press to open exactly those.</span></> : <span>Hover or focus a branch to preview it. Press it to open those appointments. Use the compare button on two people to put them side by side.</span>}
      </div>

      <div ref={wrap} className="w-full">
        {layout ? (
          <div className="ap-tree-scroll">
            <div key={run} className="ap-tree" data-hot={hot ? "1" : undefined} style={{ width: layout.width, height: layout.height + 34 }} data-testid="ap-tree" role="group" aria-label="Appointment flow tree">
              <div className="ap-tree-cols" aria-hidden>{layout.columns.map((c) => <span key={c.title} style={{ left: c.x }}>{c.title}</span>)}</div>
              <div className="ap-tree-body" style={{ width: layout.width, height: layout.height }}>
                <svg className="ap-svg" width={layout.width} height={layout.height} aria-hidden>
                  {layout.links.map((l, i) => <path key={l.id} d={l.d} className="ap-lk" data-tone={l.tone} data-hot={hotSet && hotSet.has(l.to) ? "1" : undefined} data-anim={reduced ? undefined : "1"} pathLength={1} strokeWidth={l.width} style={{ ["--d" as string]: `${Math.min(900, i * 28)}ms` }} />)}
                </svg>
                {layout.nodes.map((n, i) => {
                  const canCmp = n.kind === "setter" || n.kind === "closer";
                  const key = n.kind === "setter" ? `s:${n.setterId}` : `k:${n.closerId}`;
                  return (
                    <div key={n.id} className="ap-node" data-node={n.id} data-kind={n.kind} data-tone={n.tone} data-best={n.best ? "1" : undefined} data-hot={hotSet?.has(n.id) ? "1" : undefined} data-leak={leakOn && leak?.nodeId === n.id ? "1" : undefined}
                      style={{ left: n.x, top: n.y, width: n.w, height: n.h, ["--d" as string]: `${Math.min(700, 120 + i * 18)}ms` }}
                      onMouseEnter={() => setHot(n.id)} onMouseLeave={() => setHot(null)} onFocus={() => setHot(n.id)} onBlur={() => setHot(null)}>
                      <button type="button" className="ap-node-main" onClick={() => (n.kind === "more" ? setSetterLimit(100) : pick(n))} aria-label={n.kind === "more" ? `Show ${n.label}` : sentence(n)} data-testid={`ap-node-${n.kind}`}>
                        {n.kind === "root" ? <span className="block text-center"><span className="ap-root-n"><CountUp value={n.count} /></span><span className="ap-root-l block">booked</span></span>
                          : n.kind === "leaf" ? <><i aria-hidden /><span>{n.label}</span><b>{n.count}</b></>
                          : n.kind === "more" ? <span>{n.label}</span>
                          : <><span className="ap-node-name"><span>{n.label}</span>{n.best && <Sparkles aria-hidden className="size-3.5 flex-none text-[var(--tone)]" />}</span><Stats s={n.stats!} /></>}
                      </button>
                      {canCmp && <button type="button" className="ap-cmp" aria-pressed={cmp.includes(key)} aria-label={`Compare ${n.label}`} onClick={() => toggleCmp(n)} data-testid="ap-cmp"><GitCompareArrows aria-hidden className="size-3.5" /></button>}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        ) : <PhoneTree tree={tree} limit={setterLimit} onOpen={onOpen} cmp={cmp} setCmp={setCmp} next={next?.id} />}
      </div>
      {hidden > 0 && <p className="mt-2 text-sm"><button type="button" className="ap-link" onClick={() => setSetterLimit(100)}>Show {hidden} more {hidden === 1 ? "booker" : "bookers"}</button> <span className="ap-fine">Busiest people first.</span></p>}

      {cmpPeople.length > 0 && (
        <div className="s6-card mt-4" data-testid="ap-compare">
          <h3 className="s6-q">Side by side</h3>
          {cmpPeople.length < 2 ? <p className="ap-fine">Pick one more person with the compare button.</p> : (
            <table className="ap-compare"><thead><tr><th><span className="sr-only">Measure</span></th>{cmpPeople.map(({ p }) => <th key={p.name}>{p.name}</th>)}</tr></thead><tbody>
              {([["Booked", "bookings", false], ["Show rate", "showRate", true], ["No-show rate", "noShowRate", false], ["Close rate", "closeRate", true], ["Leads burned", "burned", false], ["Revenue won", "revenueCents", true]] as const).map(([label, k, higher]) => {
                const v = cmpPeople.map(({ p }) => p[k] as number | null); const best = v.every((x) => x !== null) && v[0] !== v[1] ? (higher ? (v[0]! > v[1]! ? 0 : 1) : (v[0]! < v[1]! ? 0 : 1)) : -1;
                const fmt = (x: number | null) => (x === null ? "n/a" : k === "revenueCents" ? money(x) : k === "bookings" || k === "burned" ? String(x) : pct(x));
                return <tr key={label}><td>{label}</td>{v.map((x, i) => <td key={i} data-win={best === i && label !== "Booked" ? "1" : undefined}>{fmt(x)}</td>)}</tr>;
              })}
            </tbody></table>
          )}
          <div className="mt-3 grid gap-2 md:grid-cols-2">{cmpPeople.map(({ p }) => { const c = coachingNote(p, tree.overall, tree.minBookings); return <p key={p.name} className="ap-note" data-tone={c.tone === "red" ? "red" : c.tone === "amber" ? "amber" : undefined}><b>{p.name}.</b> {c.text}</p>; })}</div>
          <button type="button" className="ap-link mt-2" onClick={() => setCmp([])}>Clear comparison</button>
        </div>
      )}
      <p className="ap-fine mt-3">Colours compare each person with your own team&apos;s average for these dates, never with an outside figure. Under {tree.minBookings} bookings a branch stays grey. {go && <button type="button" className="ap-link" onClick={() => go("help")}>How the numbers are worked out</button>}</p>
    </div>
  );
}

/** Phone: the same tree as an indented list. Every row opens exactly its appointments; 44px taps. */
function PhoneTree({ tree, limit, onOpen, cmp, setCmp, next }: { tree: ApFlowTree; limit: number; onOpen: (p: FlowPick) => void; cmp: string[]; setCmp: (f: (c: string[]) => string[]) => void; next?: string }) {
  const tones = (s: ApStats): Tone => { const o = tree.overall; if (s.bookings < tree.minBookings || s.showRate === null || o.showRate === null) return "grey"; const d = s.showRate - o.showRate, dc = s.closeRate !== null && o.closeRate !== null ? s.closeRate - o.closeRate : 0; return d <= -0.1 || dc <= -0.15 ? "red" : d >= 0.03 && dc >= 0 ? "green" : "amber"; };
  return (
    <div className="ap-plist" data-testid="ap-plist" aria-label="Appointment flow">
      <button type="button" className="ap-pbtn s6-card" style={{ padding: 12 }} onClick={() => onOpen({ title: "All booked appointments", count: tree.booked, params: {} })}><span className="ap-root-n"><CountUp value={tree.booked} /></span><span>booked, {tree.periodLabel.toLowerCase()}. Open them all.</span></button>
      {tree.setters.slice(0, limit).map((s) => (
        <details key={s.id} className="ap-pnode" data-tone={tones(s)} open={tree.setters.length <= 3}>
          <summary className="ap-pbtn"><ChevronDown aria-hidden className="size-4 flex-none" /><span className="min-w-0 flex-1"><b>{s.name}</b><span className="ap-fine block">{s.bookings} booked · {pct(s.showRate)} show · {pct(s.noShowRate)} no-show · {pct(s.closeRate)} close · {money(s.revenueCents)}</span></span><Chip tone={tones(s)}>{TONE_TEXT[tones(s)]}</Chip></summary>
          <div className="ap-pchips"><button type="button" className="s6-btn" onClick={() => onOpen({ title: `Booked by ${s.name}`, count: s.bookings, params: { booker: s.id } })}>Open {s.bookings}</button>
            <button type="button" className="s6-btn" aria-pressed={cmp.includes(`s:${s.id}`)} onClick={() => setCmp((c) => (c.includes(`s:${s.id}`) ? c.filter((x) => x !== `s:${s.id}`) : [...c.slice(-1), `s:${s.id}`]))}>{cmp.includes(`s:${s.id}`) ? "In comparison" : "Compare"}</button></div>
          <div className="ap-pkids">
            {s.closers.map((c) => (
              <div key={c.id} className="ap-pnode" data-tone={tones(c)} data-best={next === c.id ? "1" : undefined}>
                <b>{c.name}</b> <span className="ap-fine">{c.bookings} · {pct(c.showRate)} show · {pct(c.closeRate)} close</span>
                <div className="ap-pchips">{LEAF_ORDER.filter((k) => c.outcomes[k] > 0).map((k) => (
                  <button key={k} type="button" className="ap-chip" data-tone={OUTCOME_TONE[k]} style={{ minHeight: 44 }} onClick={() => onOpen({ title: `${OUTCOME_LABEL[k]}: ${s.name} to ${c.name}`, count: c.outcomes[k], params: { booker: s.id, owner: c.id, outcome: k } })}>{OUTCOME_LABEL[k]} {c.outcomes[k]}</button>
                ))}</div>
              </div>
            ))}
          </div>
        </details>
      ))}
    </div>
  );
}
