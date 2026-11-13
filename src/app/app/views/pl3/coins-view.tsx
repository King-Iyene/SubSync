"use client";

// HIDDEN at King's request (12 Nov): the old coin-stack picture. Kept in the repo, not shown anywhere, not imported by any screen.
import type React from "react";
import { layoutStacks, type Rect, type StackCol } from "@/lib/design/stack-layout";
import type { PlDrain, PlStage } from "@/lib/analytics/pipeline3-types-interim";
import { money, moneyShort } from "./format";

type Layout = NonNullable<ReturnType<typeof layoutStacks>>;
export type CoinsViewProps = {
  layout: Layout; stages: PlStage[]; drains: PlDrain[]; settle: boolean; run: number; reduced: boolean; wrap: React.RefObject<HTMLDivElement | null>;
  pickStage: (s: PlStage, stale?: boolean) => void; pickWon: () => void; pickLost: (d?: PlDrain) => void;
};

export function CoinsView({ layout, stages, drains, settle, run, reduced, wrap, pickStage, pickWon, pickLost }: CoinsViewProps) {
  const stageOf = (id: string) => stages.find((s) => s.id === id)!;
  const px = (r: Rect) => ({ x: r.x, y: r.y, width: r.w, height: r.h });
  const box = (r: Rect) => ({ left: r.x, top: r.y, width: r.w, height: r.h });
  const press = (fn: () => void) => ({ onClick: fn, onKeyDown: (e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fn(); } }, tabIndex: 0, role: "button" as const });
  const coinEl = (c: StackCol["coins"][number], i: number, n: number) => <rect key={i} className={`pl-coin pl-coin-${c.kind}`} x={c.x} y={c.y} width={c.w} height={c.h} rx={layout.vertical ? 2 : 2.75} style={{ animationDelay: `${Math.round((i / Math.max(1, n)) * 260)}ms` }} />;
  const colOf = (c: StackCol) => {
    const lab = `${c.name}: ${c.count} ${c.kind === "stage" ? "open " : ""}deals worth ${money(c.valueCents)}`;
    if (c.kind === "stage") {
      const s = stageOf(c.id);
      return <g key={c.id} className="pl-grp">{c.coins.map((k, i) => coinEl(k, i, c.coins.length))}
        {c.openRect && <rect className="pl-hit" {...px(c.openRect)} {...press(() => pickStage(s))} aria-label={`${lab}. Open them.`}><title>{lab}</title></rect>}
        {c.stuckRect && <rect className="pl-hit" {...px(c.stuckRect)} {...press(() => pickStage(s, true))} aria-label={`${c.stuckCount} stuck deals in ${c.name}. Open them.`}><title>{`${c.stuckCount} stuck in ${c.name}`}</title></rect>}</g>;
    }
    if (c.kind === "won") return <g key={c.id} className="pl-grp">{c.coins.map((k, i) => coinEl(k, i, c.coins.length))}<rect className="pl-hit" {...px(c.stack)} {...press(pickWon)} aria-label={`${lab}. Open them.`}><title>{lab}</title></rect></g>;
    return <g key={c.id} className="pl-grp">{c.coins.map((k, i) => coinEl(k, i, c.coins.length))}
      {c.segs.map((g) => { const d = drains.find((x) => x.reason === g.reason); return <rect key={g.reason} className="pl-hit" {...px(g.rect)} {...press(() => pickLost(d))} aria-label={`Lost, ${g.reason}. Open them.`}><title>{g.reason}</title></rect>; })}</g>;
  };
  return (
    <div className="pl-stackscroll" ref={wrap}><div className="pl-stacks" style={{ height: layout.height, width: layout.width }} data-settle={settle && !reduced ? "1" : "0"} data-vertical={layout.vertical ? "1" : "0"} key={`s${run}`}>
      <svg className="pl-svg" width={layout.width} height={layout.height} viewBox={`0 0 ${layout.width} ${layout.height}`} role="group" aria-label="Stacks of coins, one per stage, showing the money in each">
        <defs><pattern id="pl-hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="5" height="5" className="pl-hatch-bg" /><rect width="1.6" height="5" className="pl-hatch-line" /></pattern></defs>
        {!layout.vertical && layout.cols.map((c) => <line key={`b${c.id}`} className="pl-base" x1={c.stack.x} x2={c.stack.x + c.stack.w} y1={c.stack.y + c.stack.h + 2} y2={c.stack.y + c.stack.h + 2} />)}
        {layout.cols.map(colOf)}
      </svg>
      <div className="pl-labels">
        {layout.cols.map((c) => <button key={c.id} type="button" className={`pl-lab pl-lab-${c.kind}`} style={box(c.label)} tabIndex={-1} onClick={c.kind === "stage" ? () => pickStage(stageOf(c.id)) : c.kind === "won" ? pickWon : () => pickLost()}>
          <b>{c.name}</b><span className="pl-val tnum">{moneyShort(c.valueCents)}</span><small>{c.count} deals</small>
        </button>)}
      </div>
    </div></div>
  );
}
