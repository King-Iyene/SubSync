"use client";

import { CircleHelp, Play, RotateCcw, X } from "lucide-react";
import { CountUp, Fold, Q, useListPopup } from "./speed6-base";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { flowDots, rowId } from "@/lib/analytics/speed6";
import { fmtDuration } from "@/lib/analytics/speed-intel";
import { STEP_LABEL, type JourneyStep, type Step } from "@/lib/analytics/speed-v4-more";
import { useData } from "../session";
import { ErrorState, SkeletonRows } from "../ds";
import { useSpeedFilter } from "./speed-filter";
import { SidePopup } from "./speed-popup";
import { JourneyList } from "./speed-coverage";
import { LeadRows, useLeadActions, type LeadRow } from "./speed-rows";
import type { ComparePersonRow, CompareAccountRow } from "./speed-picture";
import "./speed6.css";

// Speed to lead, sixth pass: the control-room pieces. Few words: a card is named as the question it answers, one sentence at most, the explanation lives in the (i) mark. Every number that counts people
// opens the people behind it, in the side popup or the shared lead panel. Motion is short (150 to 250 ms), glow is only for what is active or urgent, and prefers-reduced-motion switches it all off.

// ---------------------------------------------------------------- the lead journey as an animated dot flow
const POS = (i: number, n: number) => 7 + (i / Math.max(1, n - 1)) * 86;
export function FlowCard({ multi }: { multi: boolean }) {
  const { query, range } = useSpeedFilter();
  const { data, error, reload } = useData<{ steps: JourneyStep[]; repliedRecorded: boolean }>(`speed?part=journey${query}`);
  const [open, setOpen] = useState<{ step: Step; dropped: boolean } | null>(null);
  const [run, setRun] = useState(0);
  const flow = useMemo(() => (data ? flowDots(data.steps.map((s) => ({ step: s.step, label: s.label, count: s.count })), 48) : null), [data]);
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data || !flow) return <SkeletonRows rows={3} label="Following the leads..." />;
  const n = data.steps.length;
  const last = n - 1;
  return (
    <Q sticky q="Where do my leads go?" span glow="active" testId="flow-card" tip="Each dot is a share of your leads, moving from arrived to first touch, replied, booked, showed and won. Dots that stop early fall into a drop-off bucket. Booked, showed and won come from your appointments and deals."
      sub={`${range?.sentence ?? "Last 30 days"}. Click a step or a drop-off to see the people.`}
      action={<button type="button" className="s6-btn" onClick={() => setRun((r) => r + 1)} data-testid="flow-replay"><RotateCcw aria-hidden className="size-4" />Replay</button>}>
      <div className="s6-flow" data-testid="flow" role="group" aria-label="Lead journey">
        <div className="s6-flow-line" aria-hidden />
        <div key={run} aria-hidden>
          {flow.dots.map((d) => {
            const x = POS(d.endIdx, n);
            const lost = d.endIdx < last;
            return <i key={d.id} className="s6-dot" data-lost={lost ? 1 : 0} data-won={d.endIdx === last && d.endIdx > 0 ? 1 : 0}
              style={{ ["--x1" as string]: `${x}%`, ["--y1" as string]: lost ? `${150 + (d.id % 5) * 7}px` : `${57}px`, ["--delay" as string]: `${(d.id % 24) * 0.11}s`, ["--dur" as string]: `${1.6 + d.endIdx * 0.35}s` }} />;
          })}
        </div>
        {data.steps.map((s, i) => (
          <div key={s.step} className="s6-flow-node" style={{ left: `${POS(i, n)}%` }} data-testid="flow-step" data-step={s.step}>
            <button type="button" onClick={() => setOpen({ step: s.step, dropped: false })} aria-label={`${s.label}: ${s.count.toLocaleString("en-US")} ${s.count === 1 ? "lead" : "leads"}. Open the people.`}>
              <span className="block text-[1.4rem] font-semibold leading-none sm:text-[1.75rem]" data-testid="flow-count"><CountUp value={s.count} /></span>
              <span className="s6-label mt-1 block max-w-[64px] break-words sm:max-w-none">{s.label}</span>
            </button>
          </div>
        ))}
        {flow.buckets.map((b) => (
          <div key={b.afterIdx} className="s6-flow-bucket" style={{ left: `${POS(b.afterIdx, n)}%` }}>
            <button type="button" data-testid="flow-bucket" onClick={() => setOpen({ step: data.steps[b.afterIdx + 1].step, dropped: true })} aria-label={`${b.n.toLocaleString("en-US")} ${b.label}. Open the people.`} title={b.label}>
              <b className="tnum">{b.n.toLocaleString("en-US")}</b><br />dropped
            </button>
          </div>
        ))}
      </div>
      <p className="s6-label">Each dot is {flow.per === 1 ? "one lead" : `about ${flow.per} leads`}. {data.steps[0].count.toLocaleString("en-US")} arrived.</p>
      {!data.repliedRecorded && <p className="s6-label mt-1">Replies from the lead are not recorded yet; a booked lead counts as replied until they are.</p>}
      {open && <SidePopup label={`${STEP_LABEL[open.step]}${open.dropped ? ", dropped" : ""}`} onClose={() => setOpen(null)}><JourneyList key={open.step + open.dropped} step={open.step} dropped={open.dropped} multi={multi} /></SidePopup>}
    </Q>
  );
}

// ---------------------------------------------------------------- the pulse cards (ready to act, velocity, reasons, histograms, person table)
type PulseRow = LeadRow & { dollars?: number; days?: number; nextStepNone?: boolean };
export type Pulse = {
  now: number; from: number; to: number; total: number; truncated: boolean;
  leadsByDay: Array<{ day: string; n: number }>; repliesByDay: Array<{ day: string; n: number }>; velocity: { days: number | null; n: number };
  people: Array<{ key: string; name: string; leads: number; replied: number; booked: number; showed: number; rate: number | null; unassigned: boolean; sample: Array<{ row: LeadRow; replied: boolean; booked: boolean; showed: boolean }> }>;
  ready: PulseRow[]; reasons: Array<{ key: string; label: string; n: number; rows: LeadRow[] }>; waitingTotal: number;
};
export function usePulse() {
  const { query } = useSpeedFilter();
  return useData<Pulse>(`speed?part=pulse${query}`);
}
const money = (n: number) => "$" + Math.round(n).toLocaleString("en-US");

export function DefinitionsBanner() {
  return <p className="s6-label mb-6 rounded-xl border border-[rgba(103,232,249,0.16)] px-4 py-3" data-testid="definitions">Waiting means a new lead nobody has replied to yet. Replied means a person answered. Click anything to see the people behind it.</p>;
}

function PeopleOpen({ rows, multi, note }: { rows: LeadRow[]; multi: boolean; note?: string }) {
  const actions = useLeadActions(rows);
  return (<div data-testid="pulse-list">{note && <p className="s6-label mb-2" data-testid="pulse-list-count">{note}</p>}<LeadRows rows={rows} showAccount={multi} actions={actions} testId="pulse-rows" />{actions.drawer}</div>);
}

export function ReadyCard({ multi, p }: { multi: boolean; p: Pulse }) {
  const rows = p.ready;
  const actions = useLeadActions(rows);
  return (
    <Q sticky q="Who should I reply to first?" span testId="ready-card" glow={rows.some((r) => r.nextStepNone) ? "warn" : undefined} tip="Leads nobody has replied to, with an open deal first, then the longest wait. A red flag means nobody has touched the lead and no appointment exists, so there is no next step.">
      {rows.length === 0 ? <p className="s6-label" data-testid="ready-empty">Nobody is waiting for a first reply. Nothing to do here.</p> : (
        <ul className="s6-ready" data-testid="ready-list">
          {rows.map((r, i) => (
            <li key={rowId(r)} data-testid="ready-row">
              <button type="button" className="s6-link min-w-0 flex-1 font-semibold" onClick={() => actions.show(i)} data-testid="ready-name"><span className="block truncate">{r.name}</span>{multi && <span className="s6-label block truncate">{r.locationName}</span>}</button>
              <span className="s6-chip" data-tone={(r.days ?? 0) >= 1 ? "amber" : "cyan"} data-testid="ready-days">{(r.days ?? 0) >= 1 ? `${r.days} ${r.days === 1 ? "day" : "days"} waiting` : `${fmtDuration(r.minutes * 60)} waiting`}</span>
              {(r.dollars ?? 0) > 0 && <span className="s6-chip" data-tone="green">{money(r.dollars as number)} open</span>}
              {r.nextStepNone && <span className="s6-chip" data-tone="red" data-testid="ready-nonext">Next step: none set</span>}
              <button type="button" className="s6-btn" data-kind="primary" onClick={() => actions.reply(r)} aria-label={`Reply to ${r.name}`}>Reply</button>
            </li>
          ))}
        </ul>
      )}
      {actions.drawer}
    </Q>
  );
}

export function VelocityCard({ p }: { p: Pulse }) {
  const v = p.velocity;
  return (
    <Q q="How fast do leads book?" testId="velocity-card" tip="The middle number of days from a lead arriving to its first booked appointment. Needs 5 booked leads in these dates.">
      {v.days === null ? <p className="s6-label" data-testid="velocity-empty">Needs 5 booked leads. {v.n} so far.</p> : (
        <><p className="s6-big" data-tone="cyan" data-testid="velocity-value"><CountUp value={v.days} decimals={v.days % 1 ? 1 : 0} /> <span className="text-base font-medium">{v.days === 1 ? "day" : "days"}</span></p><p className="s6-label mt-1">Typical time from lead to booking, from {v.n} booked leads.</p></>
      )}
    </Q>
  );
}

export function ReasonCard({ multi, p }: { multi: boolean; p: Pulse }) {
  const [pick, setPick] = useState<{ label: string; n: number; rows: LeadRow[] } | null>(null);
  const total = Math.max(1, p.reasons.reduce((s, r) => s + r.n, 0));
  const tone: Record<string, string> = { no_owner: "var(--s6-red)", owner_busy: "var(--s6-amber)", after_hours: "var(--s6-violet)", duplicate: "var(--s6-cyan)", no_phone: "var(--s6-amber)", dnd: "var(--s6-red)", unclear: "#4a5f8a" };
  return (
    <Q q="Why do leads wait?" testId="reason-card" tip="The main reason each waiting lead has not been answered, taken from what SubSync knows: no owner, an owner holding too many, arrived after hours, a duplicate, or no phone number.">
      {p.reasons.length === 0 ? <p className="s6-label">Nobody is waiting.</p> : (
        <ul className="grid gap-4" data-testid="reason-bars">
          {p.reasons.map((r) => (
            <li key={r.key}>
              <button type="button" className="s6-link w-full" data-testid="reason-bar" onClick={() => setPick({ label: r.label, n: r.n, rows: r.rows })} aria-label={`${r.label}: ${r.n} ${r.n === 1 ? "lead" : "leads"}. Open the people.`}>
                <span className="flex items-baseline justify-between gap-2 text-sm"><span className="font-medium">{r.label}</span><b className="tnum">{r.n.toLocaleString("en-US")}</b></span>
                <span className="s6-hbar mt-1 block"><i style={{ width: `${Math.max(3, (r.n / total) * 100)}%`, background: tone[r.key] ?? "#4a5f8a" }} /></span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {pick && <SidePopup label={pick.label} onClose={() => setPick(null)}><PeopleOpen rows={pick.rows} multi={multi} note={`${pick.n.toLocaleString("en-US")} ${pick.n === 1 ? "lead" : "leads"} waiting. ${pick.label}.${pick.n > pick.rows.length ? ` The first ${pick.rows.length} are shown.` : ""}`} /></SidePopup>}
    </Q>
  );
}

function Hist({ q, tip, data, tone, testId }: { q: string; tip: string; data: Array<{ day: string; n: number }>; tone?: "violet"; testId: string }) {
  const max = Math.max(1, ...data.map((d) => d.n));
  const total = data.reduce((s, d) => s + d.n, 0);
  return (
    <Q q={q} testId={testId} tip={tip}>
      <p className="s6-big mb-3" data-testid={`${testId}-total`}><CountUp value={total} /></p>
      <div className="s6-bars" data-tone={tone} role="img" aria-label={`${q} ${total} in all, by day`}>{data.map((d) => <div key={d.day} style={{ height: `${Math.max(d.n ? 6 : 2, (d.n / max) * 100)}%`, opacity: d.n ? 1 : 0.25 }} title={`${d.day}: ${d.n}`} />)}</div>
      <p className="s6-label mt-2 flex justify-between"><span>{data[0]?.day.slice(5)}</span><span>{data[data.length - 1]?.day.slice(5)}</span></p>
    </Q>
  );
}
export const HistCards = ({ p }: { p: Pulse }) => (<><Hist testId="hist-leads" q="How many new leads came in?" tip="New leads by day (UTC days) in these dates." data={p.leadsByDay} /><Hist testId="hist-replies" q="When did first replies happen?" tone="violet" tip="First replies by a person, by day, for leads that arrived in these dates." data={p.repliesByDay} /></>);

export function PersonCard({ multi, p }: { multi: boolean; p: Pulse }) {
  const [pick, setPick] = useState<{ title: string; rows: LeadRow[]; n: number } | null>(null);
  if (p.people.length === 0) return null;
  const cell = (who: Pulse["people"][number], col: "leads" | "replied" | "booked" | "showed") => {
    const n = who[col];
    const rows = who.sample.filter((s) => col === "leads" || s[col]).map((s) => s.row);
    return n === 0 ? <span className="s6-label">0</span> : <button type="button" className="s6-link font-semibold underline decoration-dotted underline-offset-4" data-testid={`person-${col}`} aria-label={`${who.name}: ${n} ${col}. Open the people.`} onClick={() => setPick({ title: `${who.name}: ${col}`, rows, n })}>{n.toLocaleString("en-US")}</button>;
  };
  return (
    <Q q="Who books the most?" span testId="person-card" tip="Leads each person owns, how many replied, booked and showed, and the booking rate (needs 5 leads). Leads nobody owns are in the Unassigned row.">
      <div className="overflow-x-auto"><table className="s6-table" data-testid="person-table">
        <thead><tr><th scope="col">Person</th><th scope="col">Leads</th><th scope="col">Replied</th><th scope="col">Booked</th><th scope="col">Showed</th><th scope="col">Rate</th></tr></thead>
        <tbody>{p.people.map((w) => (
          <tr key={w.key} data-unassigned={w.unassigned ? 1 : 0} data-testid="person-row"><td className="font-medium">{w.name}{w.unassigned && <span className="s6-chip ml-2" data-tone="amber">No owner</span>}</td><td>{cell(w, "leads")}</td><td>{cell(w, "replied")}</td><td>{cell(w, "booked")}</td><td>{cell(w, "showed")}</td><td>{w.rate === null ? <span className="s6-label">not enough</span> : `${w.rate}%`}</td></tr>
        ))}</tbody>
      </table></div>
      {pick && <SidePopup label={pick.title} onClose={() => setPick(null)}><PeopleOpen rows={pick.rows} multi={multi} note={`${pick.n.toLocaleString("en-US")} ${pick.n === 1 ? "lead" : "leads"}.${pick.n > pick.rows.length ? ` The first ${pick.rows.length} are shown.` : ""}`} /></SidePopup>}
    </Q>
  );
}

/** "Who was slow?": the slowest typical first replies, by person and by client account, each opening the leads behind it. */
export function WhoWasSlow({ people, accounts, multi, seePeople, win }: { people: ComparePersonRow[]; accounts: CompareAccountRow[]; multi: boolean; seePeople: boolean; win: { from: string; to: string } }) {
  const { open, node } = useListPopup(multi);
  const slowP = seePeople ? people.filter((p) => p.ranked && p.medianSeconds !== null).sort((a, b) => (b.medianSeconds as number) - (a.medianSeconds as number)).slice(0, 3) : [];
  const slowA = multi ? accounts.filter((a) => a.ranked && a.hitRate !== null).sort((a, b) => (a.hitRate as number) - (b.hitRate as number)).slice(0, 3) : [];
  const nothing = slowP.length === 0 && slowA.length === 0;
  return (
    <Q q="Who was slow?" testId="who-slow" glow={nothing ? undefined : "warn"} tip="The three slowest typical first replies by person, and the three client accounts that answered the smallest share inside their target. Needs 5 judged leads each.">
      {nothing ? <p className="s6-label" data-testid="who-slow-empty">Nobody is ranked yet. Each person or account needs 5 judged leads.</p> : (
        <ol className="grid gap-3" data-testid="who-slow-list">
          {slowP.map((p) => (
            <li key={p.userId} className="flex items-center justify-between gap-3"><button type="button" className="s6-link min-w-0 truncate font-medium" onClick={() => open(`Leads ${p.label} replied to first`, { status: "answered", person: p.userId, ...win })} data-testid="slow-person">{p.label}</button>
              <span className="s6-chip" data-tone="amber">{fmtDuration(p.medianSeconds as number)} typical</span></li>
          ))}
          {slowA.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-3"><button type="button" className="s6-link min-w-0 truncate font-medium" onClick={() => open(a.name, { status: "all", account: a.id, ...win })} data-testid="slow-account">{a.name}</button>
              <span className="s6-chip" data-tone={(a.hitRate as number) < 0.5 ? "red" : "amber"}>{Math.round((a.hitRate as number) * 100)}% in time</span></li>
          ))}
        </ol>
      )}
      {node}
    </Q>
  );
}

// ---------------------------------------------------------------- first-run tour and the guide
const TOUR_KEY = "subsync.speed.tour6";
const GUIDE: Array<[string, string]> = [
  ["Who is slow?", "Pace and People: the slowest people and client accounts."],
  ["Who should I reply to first?", "Pace: waiting leads, open deals first."],
  ["Where do my leads go?", "Pace: the animated lead journey, with drop-offs."],
  ["Which source loses leads?", "Pace, under More: cost per source."],
  ["Who was not called back?", "Coverage: missed calls with no callback."],
  ["Who do I call next?", "Call mode: a ranked list, one lead at a time."],
  ["When is someone told?", "Rules: reply target, escalation and the digest."],
];
export function Guide({ onClose }: { onClose: () => void }) {
  return (
    <div className="s6-tour" role="dialog" aria-modal="true" aria-label="What can I do here" data-testid="s6-guide" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="s6">
        <div className="mb-4 flex items-center justify-between"><h2 className="text-lg font-semibold">What can I do here?</h2><button type="button" className="s6-link p-2" onClick={onClose} aria-label="Close"><X aria-hidden className="size-5" /></button></div>
        <ul className="grid gap-3">{GUIDE.map(([q, a]) => <li key={q}><p className="font-semibold">{q}</p><p className="s6-label">{a}</p></li>)}</ul>
      </div>
    </div>
  );
}
const TOUR: Array<[string, string]> = [["Race", "Who is waiting for a reply right now, with a live clock."], ["Pace", "How fast you reply, and where leads go."], ["Call mode", "Work the people to call, one at a time."], ["Rules", "Set the reply target and who is told."]];
/** A one-time 60-second tour. Remembered in this browser; the "?" button opens the guide again at any time. */
export function Tour() {
  const [step, setStep] = useState<number | null>(null);
  useEffect(() => { const t = setTimeout(() => { try { if (window.localStorage.getItem(TOUR_KEY) !== "1") setStep(0); } catch { /* shown once per visit */ } }, 0); return () => clearTimeout(t); }, []);
  if (step === null) return null;
  const done = () => { try { window.localStorage.setItem(TOUR_KEY, "1"); } catch { /* remembered next time */ } setStep(null); };
  const [t, d] = TOUR[step];
  return (
    <div className="s6-tour" role="dialog" aria-modal="true" aria-label="Quick tour" data-testid="s6-tour">
      <div className="s6">
        <p className="s6-label mb-2">Quick tour, {step + 1} of {TOUR.length}</p>
        <h2 className="text-xl font-semibold">{t}</h2><p className="mt-2 text-[0.95rem]">{d}</p>
        <div className="mt-6 flex items-center justify-between gap-3">
          <button type="button" className="s6-link text-sm underline" onClick={done} data-testid="tour-skip">Skip</button>
          <button type="button" className="s6-btn" data-kind="primary" data-testid="tour-next" onClick={() => (step + 1 >= TOUR.length ? done() : setStep(step + 1))}><Play aria-hidden className="size-4" />{step + 1 >= TOUR.length ? "Done" : "Next"}</button>
        </div>
      </div>
    </div>
  );
}
export function GuideButton({ onClick }: { onClick: () => void }) {
  return <button type="button" onClick={onClick} className="s6-btn" data-testid="s6-guide-open" aria-label="What can I do here"><CircleHelp aria-hidden className="size-4" />What can I do here</button>;
}


// ---------------------------------------------------------------- the Pace and People tabs, composed
type SlowProps = { people: ComparePersonRow[]; accounts: CompareAccountRow[]; seePeople: boolean; win: { from: string; to: string } };
/** Pace: three cards first (the journey, who to reply to first, who was slow), everything else behind More. Older cards follow in the same fold. */
export function PaceTab6({ multi, slow, old }: { multi: boolean; slow: SlowProps; old: ReactNode }) {
  const { data: p, error, reload } = usePulse();
  return (
    <div data-testid="pace-tab6">
      <DefinitionsBanner />
      {error ? <ErrorState error={error} onRetry={reload} /> : (
        <Fold keep={3} testId="pace-fold">
          <div className="s6-grid s6-three">
            <FlowCard multi={multi} />
            {p ? <ReadyCard multi={multi} p={p} /> : <SkeletonRows rows={3} label="Ranking the leads..." />}
            <WhoWasSlow multi={multi} {...slow} />
            {p && <><VelocityCard p={p} /><ReasonCard multi={multi} p={p} /><HistCards p={p} /></>}
          </div>
          {old}
        </Fold>
      )}
    </div>
  );
}
export function PeopleTab6({ multi, slow, old }: { multi: boolean; slow: SlowProps; old: ReactNode }) {
  const { data: p, error, reload } = usePulse();
  return (
    <div data-testid="people-tab6">
      {error ? <ErrorState error={error} onRetry={reload} /> : (
        <Fold keep={3} testId="people-fold">
          <div className="s6-grid s6-three">
            <WhoWasSlow multi={multi} {...slow} />
            {p ? <PersonCard multi={multi} p={p} /> : <SkeletonRows rows={3} label="Counting who books..." />}
          </div>
          {old}
        </Fold>
      )}
    </div>
  );
}
