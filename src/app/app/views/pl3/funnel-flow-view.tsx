"use client";

import { breakdown, dealsText, pctText, winTimeText, type FlowPaths, type PathSeg } from "@/lib/design/flow-paths";
import { initials } from "@/lib/design/funnel-fx";

// "Who actually won" under the funnel: a row of people chips and two stacked bars (by person, by where the lead came from). The Funnel itself lives in funnel-dots-view.tsx.
// Every chip and segment is a button that opens exactly those won deals (the number and the rows behind it are counted by the same rule).
/** Colours for the stacked "who won" bars and chips: the theme's own chart colours, so it works in light and dark. */
const SEG = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];

function Stack({ title, kind, segs, total, dealsMode, sample, onPick, fmt }: { title: string; kind: "owner" | "source"; segs: PathSeg[]; total: { n: number; cents: number }; dealsMode: boolean; sample: boolean; onPick: (s: PathSeg) => void; fmt: (v: number) => string }) {
  const b = breakdown(segs, 8, total), share = (n: number) => `${Math.max(0.5, (n / Math.max(1, total.n)) * 100)}%`;
  if (!b.shown.length) return null;
  return (
    <div className="ff-stack" data-testid={`ff-won-by-${kind}`}>
      <h5 className="ff-h5">{title}</h5>
      <div className="ff-bar-row" role="group" aria-label={title}>
        {b.shown.map((s, i) => <button key={s.key} type="button" className="ff-seg" style={{ width: share(s.n), background: SEG[i % SEG.length] }} disabled={sample} onClick={() => onPick(s)} title={`${s.name}: ${dealsText(s.n)}${dealsMode ? "" : `, ${fmt(s.cents)}`}`} aria-label={`${s.name}: ${dealsText(s.n)} won. Open them.`} data-testid={`ff-seg-${kind}-${i}`} />)}
        {b.rest && <span className="ff-seg ff-seg-rest" style={{ width: share(b.rest.n) }} title={`Everyone else: ${dealsText(b.rest.n)}`} />}
      </div>
      <ul className="ff-legend">
        {b.shown.map((s, i) => <li key={s.key}><i style={{ background: SEG[i % SEG.length] }} aria-hidden />{sample ? <span>{s.name}</span> : <button type="button" className="ap-link" onClick={() => onPick(s)}>{s.name}</button>} <b className="tnum">{dealsText(s.n)}</b><span className="ap-sub tnum"> {pctText(s.n, total.n)}{dealsMode ? "" : `, ${fmt(s.cents)}`}</span></li>)}
        {b.rest && <li><i className="ff-rest" aria-hidden /><span>Everyone else</span> <b className="tnum">{dealsText(b.rest.n)}</b></li>}
      </ul>
    </div>
  );
}

export function WhoWon({ paths, dealsMode, sample, animate, onWon, onWonBy, fmt, fmtShort }: { paths: FlowPaths; dealsMode: boolean; sample: boolean; animate: boolean; onWon: () => void; onWonBy: (k: "owner" | "source", s: PathSeg) => void; fmt: (v: number) => string; fmtShort: (v: number) => string }) {
  const w = paths.won, total = { n: w.n, cents: w.cents }, time = winTimeText(w.medianDays);
  if (w.n === 0) return <section className="ff-section" data-testid="ff-who"><h4 className="ff-h">Who actually won</h4><p className="ap-fine">No wins in these dates, so there is nobody to credit yet.</p></section>;
  const chips = breakdown(w.byOwner, 8, total).shown;
  return (
    <section className="ff-section" aria-label="Who actually won" data-testid="ff-who">
      <h4 className="ff-h">Who actually won</h4>
      <p className="ap-fine">{sample ? <b>{dealsText(w.n)} won{dealsMode ? "" : `, ${fmtShort(w.cents)}`}</b> : <button type="button" className="ap-link" onClick={onWon} data-testid="ff-won-all"><b>{dealsText(w.n)} won{dealsMode ? "" : `, ${fmtShort(w.cents)}`}</b></button>} in these dates.{time ? ` A deal took ${time} from created to won (the middle one).` : " Time to win: not enough history yet."}</p>
      {chips.length > 0 && (
        <div className="ff-chips-wrap" data-testid="ff-chips">
          <span className="ff-chips-arrow" aria-hidden>Won</span>
          <ul className="ff-chips" data-anim={animate ? "1" : "0"} aria-label="People who won deals, most wins first">
            {chips.map((s, i) => <li key={s.key} style={{ ["--i" as string]: i }}>
              {sample ? <span className="ff-chip" title={`${s.name}: ${dealsText(s.n)} won`}><i style={{ background: SEG[i % SEG.length] }}>{initials(s.name)}</i><b>{dealsText(s.n)}</b></span>
                : <button type="button" className="ff-chip" onClick={() => onWonBy("owner", s)} title={`${s.name}: ${dealsText(s.n)} won`} aria-label={`${s.name}: ${dealsText(s.n)} won. Open them.`}><i style={{ background: SEG[i % SEG.length] }}>{initials(s.name)}</i><b>{dealsText(s.n)}</b></button>}
            </li>)}
          </ul>
        </div>
      )}
      <p className="ap-fine">Each circle is a person; the number is the deals they won. Longer bars below mean more wins.</p>
      <div className="ff-stacks">
        <Stack title="By person" kind="owner" segs={w.byOwner} total={total} dealsMode={dealsMode} sample={sample} onPick={(s) => onWonBy("owner", s)} fmt={fmt} />
        <Stack title="By where the lead came from" kind="source" segs={w.bySource} total={total} dealsMode={dealsMode} sample={sample} onPick={(s) => onWonBy("source", s)} fmt={fmt} />
      </div>
    </section>
  );
}
