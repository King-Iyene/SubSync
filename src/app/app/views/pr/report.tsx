import type { CSSProperties, ReactNode } from "react";
import { accentTokens } from "@/lib/design/color";
import {
  changeOf, fmtInt, longDay, monthName, fmtMinutes, fmtMoney, fmtPct, headline, METRIC_INFO, NOT_ENOUGH_DATA, NOT_ENOUGH_LEADS, NOT_RECORDED, trendReady, type Brand, type Change, type InfoKey, type PrPayload, type Sections,
} from "@/lib/analytics/proof-core";
import { durationText } from "@/lib/analytics/moat-core";
import { BrandLogo } from "../../brand-logo";
import { PR_CSS } from "./report-css";

// The client's report: plain markup with no script and no hooks, so the public page draws it on the server and the app draws it as a preview. The company's own name, logo and colour are on it;
// the product's name and the platform's name never are. Every figure has one line of plain meaning and the way it is counted one tap away (all of them are written out when printed). A figure
// that was not measured says so in words; nothing is drawn as a flat line or a zero that was not counted.

const SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DEFAULT_ACCENT = "#504c45";

export function accentVars(color: string | null): CSSProperties {
  const c = color ?? DEFAULT_ACCENT;
  const l = accentTokens(c, "light"), d = accentTokens(c, "dark");
  return { "--pr-accent": l?.fill ?? DEFAULT_ACCENT, "--pr-on-accent": l?.onFill ?? "#ffffff", "--pr-accent-text": l?.text ?? DEFAULT_ACCENT, "--pr-accent-text-l": l?.text ?? DEFAULT_ACCENT, "--pr-accent-text-d": d?.text ?? "#91c4a9" } as CSSProperties;
}

function Card({ info, value, sub, change, note, na }: { info: InfoKey; value?: ReactNode; sub?: string; change?: Change; note?: string; na?: string }) {
  const i = METRIC_INFO[info];
  return (
    <div className="pr-card" data-testid={`pr-m-${info}`}>
      <p className="pr-kicker">{i.label}</p>
      {na ? <p className="pr-na">{na}</p> : <p className="pr-value">{value}{sub ? <> <small>{sub}</small></> : null}</p>}
      {!na && change && <p className="pr-change" data-tone={change.tone}>{change.text}</p>}
      <p className="pr-mean">{note ?? i.meaning}</p>
      <details className="pr-how"><summary>How this is counted</summary><p>{i.formula}</p></details>
    </div>
  );
}

function TrendChart({ title, months, values, fmt, pct, startsOn }: { title: string; months: string[]; values: Array<number | null>; fmt: (n: number) => string; pct?: boolean; startsOn: string | null }) {
  if (!trendReady(values)) {
    return <div className="pr-card pr-chart"><p className="pr-kicker">{title}</p><p className="pr-na">Not enough history yet{startsOn ? `. Our record for this account starts ${longDay(startsOn)}` : ""}.</p></div>;
  }
  const W = 300, H = 112, L = 10, R = 14, T = 22, B = 20, real = values.filter((v): v is number => v !== null);
  const lo = pct ? 0 : Math.min(0, ...real), hi = pct ? 100 : Math.max(...real, 1), span = hi - lo || 1;
  const x = (i: number) => L + (i / (months.length - 1)) * (W - L - R), y = (v: number) => T + (1 - (v - lo) / span) * (H - T - B);
  const segs: string[][] = [];
  values.forEach((v, i) => { if (v === null) { segs.push([]); return; } if (!segs.length) segs.push([]); segs[segs.length - 1].push(`${x(i).toFixed(1)},${y(v).toFixed(1)}`); });
  const lastI = values.map((v, i) => (v === null ? -1 : i)).filter((i) => i >= 0).pop() as number;
  const label = `${title} by month: ${months.map((m, i) => `${SHORT[Number(m.slice(5, 7)) - 1]} ${values[i] === null ? "not recorded" : fmt(values[i] as number)}`).join(", ")}`;
  return (
    <div className="pr-card pr-chart">
      <p className="pr-kicker">{title}</p>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
        <line className="gd" x1={L} x2={W - R} y1={y(lo)} y2={y(lo)} />
        {segs.filter((s) => s.length > 1).map((s, k) => <polyline key={k} className="ln" points={s.join(" ")} />)}
        {values.map((v, i) => (v === null ? null : <circle key={i} className="dot" cx={x(i)} cy={y(v)} r={3.2} />))}
        <text className="vx" x={Math.min(W - R, x(lastI))} y={y(values[lastI] as number) - 8} textAnchor="end">{fmt(values[lastI] as number)}</text>
        {months.map((m, i) => <text key={m} className="tx" x={x(i)} y={H - 4} textAnchor={i === 0 ? "start" : i === months.length - 1 ? "end" : "middle"}>{SHORT[Number(m.slice(5, 7)) - 1]}</text>)}
      </svg>
    </div>
  );
}

export function ProofReport({ p, brand, intro, summary = null, sections, nameStaff, sample = false, auto = false, children }: {
  p: PrPayload; brand: Brand; intro: string | null; /** The summary the agency reviewed and chose to use (AI-written or not). Never an unreviewed draft. */ summary?: string | null; sections: Sections; nameStaff: boolean; sample?: boolean; auto?: boolean; children?: ReactNode;
}) {
  const prev = monthName(p.prevLabel), noLeads = p.replyMedian.current === null && (p.leads.current ?? 0) < 5;
  const lead = p.leads;
  const caught = p.caught;
  const mov = p.moved, won = p.won;
  const per = p.partial ? `${p.label.split(" ")[0]} so far` : p.label;
  return (
    <div className="pr-doc" style={accentVars(brand.color)} data-auto={auto ? "" : undefined} data-testid="pr-report">
      <style dangerouslySetInnerHTML={{ __html: PR_CSS }} />
      <div className="pr-wrap">
        {sample && <p className="pr-sample" role="status" data-testid="pr-sample">Sample data: this is an example, not a real client.</p>}
        <header className="pr-head">
          <div className="pr-brand">{brand.logoUrl ? <BrandLogo url={brand.logoUrl} name={brand.name} height={40} fallback={<span className="pr-brand-name">{brand.name}</span>} /> : brand.name === "Monthly report" ? null : <span className="pr-brand-name">{brand.name}</span>}</div>
          <p className="pr-eyebrow">Monthly report</p>
          <h1 data-testid="pr-account">{p.account}</h1>
          <p className="pr-meta">{per}{p.partial ? `, to ${longDay(p.to)}` : ""}. Counted from this account&apos;s own records.</p>
        </header>
        {children}
        {intro && <p className="pr-intro" data-testid="pr-intro">{intro}</p>}
        <p className="pr-lead" data-testid="pr-headline">{headline(p)}</p>
        {summary && <section className="pr-summary" aria-label="Summary" data-testid="pr-summary"><p className="pr-kicker">Summary</p><div className="pr-summary-body">{summary}</div></section>}

        <section className="pr-sec" aria-label="Leads and reply speed">
          <h2>{sections.reply ? "Leads and reply speed" : "Leads"}</h2>
          <div className="pr-grid">
            <Card info="leads" value={lead.current === null ? undefined : fmtInt(lead.current)} na={lead.current === null ? NOT_RECORDED : undefined} change={changeOf("count", lead.current, lead.previous, prev)} />
            {sections.reply && <>
              <Card info="reply" value={p.replyMedian.current === null ? undefined : fmtMinutes(p.replyMedian.current)} na={p.replyMedian.current === null ? (noLeads ? NOT_ENOUGH_LEADS : NOT_ENOUGH_DATA) : undefined} change={changeOf("minutes", p.replyMedian.current, p.replyMedian.previous, prev, "down")} />
              <Card info="within" value={p.withinTarget.current === null ? undefined : fmtPct(p.withinTarget.current)} sub={p.withinTarget.current === null ? undefined : `answered within ${durationText(p.targetMinutes)}`} na={p.withinTarget.current === null ? (noLeads ? NOT_ENOUGH_LEADS : NOT_ENOUGH_DATA) : undefined} change={changeOf("pct", p.withinTarget.current, p.withinTarget.previous, prev)}
                note={`${METRIC_INFO.within.meaning} The reply time agreed for this account is ${durationText(p.targetMinutes)}, counted in ${p.clock}.`} />
              <Card info="recovered" value={p.recovered.current === null ? undefined : fmtInt(p.recovered.current)} na={p.recovered.current === null ? NOT_RECORDED : undefined} change={changeOf("count", p.recovered.current, p.recovered.previous, prev)} />
            </>}
          </div>
        </section>

        {sections.appointments && (
          <section className="pr-sec" aria-label="Appointments">
            <h2>Appointments</h2>
            <div className="pr-grid">
              <Card info="booked" value={p.booked.current === null ? undefined : fmtInt(p.booked.current)} na={p.booked.current === null ? NOT_RECORDED : undefined} change={changeOf("count", p.booked.current, p.booked.previous, prev)} />
              <Card info="noshow" value={p.noShowRate.current === null ? undefined : fmtPct(p.noShowRate.current)} sub={p.showed.current === null ? undefined : `${fmtInt(p.showed.current)} showed up`} na={p.noShowRate.current === null ? "Not enough appointments with a recorded outcome yet" : undefined} change={changeOf("pct", p.noShowRate.current, p.noShowRate.previous, prev, "down")} />
            </div>
          </section>
        )}

        {sections.pipeline && (
          <section className="pr-sec" aria-label="Deals">
            <h2>Deals</h2>
            <div className="pr-grid">
              <Card info="moved" value={mov.deals.current === null ? undefined : fmtInt(mov.deals.current)} sub={mov.value.current === null ? undefined : `worth ${fmtMoney(mov.value.current)}`} na={mov.deals.current === null ? NOT_RECORDED : undefined} change={changeOf("count", mov.deals.current, mov.deals.previous, prev)} />
              <Card info="won" value={won.deals.current === null ? undefined : fmtInt(won.deals.current)} sub={won.value.current === null ? undefined : `worth ${fmtMoney(won.value.current)}`} na={won.deals.current === null ? NOT_RECORDED : undefined} change={won.value.current !== null ? changeOf("money", won.value.current, won.value.previous, prev) : changeOf("count", won.deals.current, won.deals.previous, prev)} />
            </div>
          </section>
        )}

        {sections.caught && (
          <section className="pr-sec" aria-label="What was caught and fixed">
            <h2>What was caught and fixed</h2>
            {caught.found === null ? <p className="pr-calm">{NOT_RECORDED}. Our daily checks have not recorded anything for this account this month yet.</p> : (
              <div className="pr-grid">
                <Card info="caught" value={fmtInt(caught.found)} sub={caught.found === 1 ? "problem" : "problems"} />
                <Card info="fixed" value={fmtInt(caught.fixed ?? 0)} sub={`of ${fmtInt(caught.found)}`} note={`${METRIC_INFO.fixed.meaning}${caught.stillOpen ? ` ${fmtInt(caught.stillOpen)} still open.` : " None are still open."}${caught.typicalFixMinutes !== null && (caught.fixed ?? 0) > 0 ? ` Typically cleared within ${durationText(caught.typicalFixMinutes)}.` : ""}`} />
              </div>
            )}
          </section>
        )}

        {sections.timeline && (
          <section className="pr-sec" aria-label="What we did for you">
            <h2>What we did for you</h2>
            {p.timeline.length === 0 ? <p className="pr-calm">Nothing needed fixing and nothing was won back that we recorded this month{p.historyStarts ? `. Our record for this account starts ${longDay(p.historyStarts)}` : ""}.</p> : (
              <ol className="pr-tl" data-testid="pr-timeline">{p.timeline.map((t, i) => <li key={`${t.on}-${i}`}><time dateTime={t.on}>{longDay(t.on)}</time>{t.text}</li>)}</ol>
            )}
          </section>
        )}

        {sections.trends && (
          <section className="pr-sec" aria-label="Trend lines">
            <h2>Month by month</h2>
            <div className="pr-charts" data-testid="pr-trends">
              <TrendChart title="New leads" months={p.trend.map((t) => t.month)} values={p.trend.map((t) => t.leads)} fmt={fmtInt} startsOn={p.historyStarts} />
              <TrendChart title="Answered in time" months={p.trend.map((t) => t.month)} values={p.trend.map((t) => t.withinPct)} fmt={fmtPct} pct startsOn={p.historyStarts} />
              <TrendChart title="Show rate" months={p.trend.map((t) => t.month)} values={p.trend.map((t) => t.showRate)} fmt={fmtPct} pct startsOn={p.historyStarts} />
              <TrendChart title="Value of deals won" months={p.trend.map((t) => t.month)} values={p.trend.map((t) => t.won)} fmt={fmtMoney} startsOn={p.historyStarts} />
            </div>
            <p className="pr-meta" style={{ marginTop: "0.6rem" }}>{p.historyStarts ? `Our record for this account starts ${longDay(p.historyStarts)}. Months before that are not shown.` : "Lines appear once there are two months on record."}</p>
          </section>
        )}

        {nameStaff && p.team && p.team.length > 0 && (
          <section className="pr-sec" aria-label="Who replied first">
            <h2>Who replied first</h2>
            <table className="pr-team"><thead><tr><th>Team member</th><th>First replies</th><th>Typical first reply</th></tr></thead>
              <tbody>{p.team.map((t) => <tr key={t.name}><td>{t.name}</td><td>{fmtInt(t.firstReplies)}</td><td>{t.medianMinutes === null ? NOT_ENOUGH_DATA : fmtMinutes(t.medianMinutes)}</td></tr>)}</tbody></table>
          </section>
        )}

        <footer className="pr-foot">
          <div className="pr-formulas" data-testid="pr-formulas">
            <h2>How each figure is counted</h2>
            <dl>
            {(["leads", "reply", "within", "recovered", "booked", "noshow", "moved", "won", "caught", "fixed"] as InfoKey[]).map((k) => <div key={k}><dt>{METRIC_INFO[k].label}</dt><dd>{METRIC_INFO[k].formula}</dd></div>)}
            </dl>
          </div>
          <p>These figures are counted from this account&apos;s own records for the period shown and compared only with its own earlier month. They describe the past and are not a promise about the future.</p>
          <p>Prepared {longDay(p.builtAt.slice(0, 10))}.{p.historyStarts ? ` Our record for this account starts ${longDay(p.historyStarts)}.` : ""}</p>
        </footer>
      </div>
    </div>
  );
}
