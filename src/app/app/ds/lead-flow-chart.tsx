"use client";

import { useMemo, useState } from "react";
import { NODE_INFO, NODE_LABEL, type Flow, type NodeId } from "@/lib/analytics/lead-flow";

// Lead flow, drawn as a flow chart (Sankey style) in SVG from Today's own tokens. Four columns: new leads, what happened to the first reply, whether an appointment was
// booked, how the appointment went. Every step (a bar) and every link (a ribbon) is a button that opens the people behind it; hover or focus says how many and what it means.
// Colour is never the only signal: every step has its name and number written next to it, and a hidden table carries all the figures.

const W = 860, H = 300, NW = 14, GAP = 12, TOP = 8;
const COLX = [0, 210, 430, 680];
const COLOUR: Record<NodeId, string> = {
  new: "var(--t-c1)", replied: "var(--t-c1)", never: "var(--t-ink3)", unknown: "var(--t-c3)", booked: "var(--t-c1)", nobook: "var(--t-ink3)", showed: "var(--t-c1)", noshow: "var(--t-ink3)", waiting: "var(--t-c3)",
};

type Box = { id: NodeId; x: number; y: number; h: number; count: number };
export function layout(flow: Flow) {
  const byCol = new Map<number, typeof flow.nodes>();
  for (const n of flow.nodes) if (n.count > 0 || n.id === "new") byCol.set(n.col, [...(byCol.get(n.col) ?? []), n]);
  const total = Math.max(1, flow.total);
  const maxGaps = Math.max(...[...byCol.values()].map((c) => c.length - 1), 0);
  const scale = (H - TOP * 2 - maxGaps * GAP) / total;
  const boxes = new Map<NodeId, Box>();
  for (const [col, list] of byCol) {
    const used = list.reduce((s, n) => s + Math.max(3, n.count * scale), 0) + (list.length - 1) * GAP;
    let y = TOP + (H - TOP * 2 - used) / 2;
    for (const n of list) { const h = Math.max(3, n.count * scale); boxes.set(n.id, { id: n.id, x: COLX[col], y, h, count: n.count }); y += h + GAP; }
  }
  // Ribbons: stacked down each step's right edge (out) and left edge (in), in the order of the steps they join.
  const outAt = new Map<NodeId, number>(), inAt = new Map<NodeId, number>();
  const ribbons = flow.links.filter((l) => l.count > 0 && boxes.has(l.from) && boxes.has(l.to)).map((l) => {
    const a = boxes.get(l.from) as Box, b = boxes.get(l.to) as Box;
    const h = Math.max(1.5, l.count * scale);
    const y0 = a.y + (outAt.get(l.from) ?? 0), y1 = b.y + (inAt.get(l.to) ?? 0);
    outAt.set(l.from, (outAt.get(l.from) ?? 0) + h); inAt.set(l.to, (inAt.get(l.to) ?? 0) + h);
    const x0 = a.x + NW, x1 = b.x, mx = (x0 + x1) / 2;
    return { ...l, h, d: `M${x0},${y0 + h / 2} C${mx},${y0 + h / 2} ${mx},${y1 + h / 2} ${x1},${y1 + h / 2}` };
  });
  return { boxes: [...boxes.values()], ribbons };
}

const pct = (n: number | null) => (n === null ? "" : ` (${n}%)`);

export function LeadFlowChart({ flow, onNode, onLink, label }: { flow: Flow; onNode: (id: NodeId) => void; onLink: (from: NodeId, to: NodeId) => void; label: string }) {
  const { boxes, ribbons } = useMemo(() => layout(flow), [flow]);
  const [tip, setTip] = useState<string | null>(null);
  const node = (id: NodeId) => flow.nodes.find((n) => n.id === id)!;
  const press = (fn: () => void) => (e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fn(); } };
  return (
    <figure className="min-w-0" data-testid="lead-flow-chart">
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full overflow-visible" role="group" aria-label={label}>
        {ribbons.map((r) => {
          const text = `${NODE_LABEL[r.from]} then ${NODE_LABEL[r.to].toLowerCase()}: ${r.count} ${r.count === 1 ? "lead" : "leads"}. See them.`;
          return (
            <path key={`${r.from}-${r.to}`} d={r.d} fill="none" stroke={COLOUR[r.to]} strokeOpacity={0.3} strokeWidth={r.h} role="button" tabIndex={0} aria-label={text}
              data-testid="flow-link" data-from={r.from} data-to={r.to} data-count={r.count} className="cursor-pointer outline-none transition-[stroke-opacity] hover:[stroke-opacity:0.55] focus-visible:[stroke-opacity:0.6]"
              onClick={() => onLink(r.from, r.to)} onKeyDown={press(() => onLink(r.from, r.to))} onMouseEnter={() => setTip(text.replace(" See them.", ""))} onMouseLeave={() => setTip(null)} onFocus={() => setTip(text.replace(" See them.", ""))} onBlur={() => setTip(null)}>
              <title>{text}</title>
            </path>
          );
        })}
        {boxes.map((b) => {
          const n = node(b.id);
          const text = `${n.label}: ${n.count} ${n.count === 1 ? "lead" : "leads"}${pct(n.pct)}. ${NODE_INFO[b.id]} See them.`;
          const right = b.x < COLX[3];
          return (
            <g key={b.id}>
              <rect x={b.x} y={b.y} width={NW} height={b.h} rx={2} fill={COLOUR[b.id]} role="button" tabIndex={0} aria-label={text} data-testid="flow-node" data-node={b.id} data-count={n.count}
                className="cursor-pointer outline-none hover:brightness-110 focus-visible:stroke-[var(--t-ink)] focus-visible:stroke-2" onClick={() => onNode(b.id)} onKeyDown={press(() => onNode(b.id))}
                onMouseEnter={() => setTip(text.replace(" See them.", ""))} onMouseLeave={() => setTip(null)} onFocus={() => setTip(text.replace(" See them.", ""))} onBlur={() => setTip(null)}>
                <title>{text}</title>
              </rect>
              <text x={right ? b.x + NW + 8 : b.x + NW + 8} y={b.y + Math.min(b.h / 2, 14)} dominantBaseline="middle" pointerEvents="none"
                style={{ fontSize: 12.5, fill: "var(--t-ink)", paintOrder: "stroke", stroke: "var(--t-raise)", strokeWidth: 3, strokeLinejoin: "round" }}>
                <tspan fontWeight={500}>{n.label}</tspan><tspan className="t-num" dx={6} style={{ fill: "var(--t-ink2)" }}>{n.count.toLocaleString("en-US")}{pct(n.pct)}</tspan>
              </text>
            </g>
          );
        })}
      </svg>
      <p className="t-small t-quiet mt-1 min-h-5" role="status" aria-live="polite" data-testid="flow-tip">{tip ?? "Select a step or a band to see the people. Each band is the leads that went from one step to the next."}</p>
      <div className="sr-only">
        <table><caption>{label}</caption><thead><tr><th>Step</th><th>Leads</th><th>Share</th></tr></thead>
          <tbody>{flow.nodes.map((n) => <tr key={n.id}><td>{n.label}</td><td>{n.count}</td><td>{n.pct === null ? "not shown" : `${n.pct}% ${n.of}`}</td></tr>)}</tbody></table>
      </div>
    </figure>
  );
}
