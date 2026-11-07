"use client";

import { useState } from "react";
import { LeadMark, LeadTag } from "./speed-lead-row";
import { humanWait } from "@/lib/design/wait";
import { ErrorState, SkeletonRows } from "../ds";
import { WhatIs } from "../ds/what-is";
import { useApiClient, useData } from "../session";
import { useSpeedFilter } from "./speed-filter";
import { SidePopup } from "./speed-popup";

// Speed to lead, fifth pass (stage SPEED5): the booking-by-reply-time chart, the money-at-risk meter, the duplicate and repeat chips, and the escalation ladder with its dry-run preview.
// Little text; the reasons live in hover tips. A click opens a side popup. Nothing here sends anything: assigning goes through the existing write gateway, and the alerts follow the
// alert switches in Settings (off, so a dry run).

const usd = (n: number) => "$" + Math.round(n).toLocaleString("en-US");
const BTN = "ds-press inline-flex min-h-11 cursor-pointer items-center rounded-md border bg-card px-3 text-sm font-medium hover:border-primary/40 sm:min-h-9";

// ---------------------------------------------------------------- booking rate by first-reply time (Pace)
type Booking = {
  now: number; days: number; bookWithinDays: number; appointmentsRecorded: boolean; total: number; enough: boolean; fastRate: number | null; slowRate: number | null; multiple: number | null; fastLeads: number; slowLeads: number;
  buckets: Array<{ key: string; label: string; leads: number; booked: number; rate: number | null; enough: boolean }>;
};

export function BookingCard() {
  const { range } = useSpeedFilter();
  const { data: d, error, reload } = useData<Booking>(`speed?part=booking${range ? `&from=${range.from}&to=${range.to}` : ""}`);
  const [open, setOpen] = useState<string | null>(null);
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!d) return <SkeletonRows rows={3} label="Counting bookings..." />;
  const pct = (x: number | null) => (x === null ? "n/a" : `${Math.round(x * 10) / 10}%`);
  const line = d.multiple !== null && d.fastRate !== null && d.slowRate !== null
    ? `Leads answered within 15 minutes booked ${pct(d.fastRate * 100)} of the time, against ${pct(d.slowRate * 100)} when the reply took over an hour: ${d.multiple} times as often.`
    : d.enough ? "Fast and slow replies cannot be compared yet: each group needs 10 leads." : `Not enough leads yet (${d.total} of 30). The chart fills in as leads arrive.`;
  const max = Math.max(10, ...d.buckets.map((b) => b.rate ?? 0));
  return (
    <section aria-labelledby="booking" className="spd-rise mb-10 border-t border-[var(--t-rule)] pt-5" data-testid="booking-card">
      <h3 id="booking" className="t-title mb-1">Bookings by how fast the first reply came <WhatIs text={`Share of the last ${d.days} days of leads that got an appointment within ${d.bookWithinDays} days, grouped by how long the first person reply took. A group needs 10 leads; the chart needs 30.`} /></h3>
      <p className="t-small mb-3 max-w-3xl" data-testid="booking-line">{line}</p>
      <ul className="max-w-xl space-y-1.5" data-testid="booking-bars">
        {d.buckets.map((b) => (
          <li key={b.key}>
            <button type="button" onClick={() => setOpen(b.key)} data-testid={`booking-${b.key}`} data-tip={b.enough ? `${b.booked} of ${b.leads} leads booked. Click for details.` : `${b.leads} leads. Needs 10 to show a rate.`}
              className="ds-press grid w-full cursor-pointer grid-cols-[7.5rem_minmax(0,1fr)_3.5rem] items-center gap-2 rounded-md py-1 text-left text-sm hover:bg-[var(--t-raise)] focus-visible:outline-2 focus-visible:outline-[var(--ring)]">
              <span className="truncate">{b.label}</span>
              <span className="h-3 rounded-full bg-[var(--t-raise)]" aria-hidden><span className="block h-3 rounded-full bg-[var(--t-accent)]" style={{ width: `${b.rate === null ? 0 : Math.max(2, (b.rate / max) * 100)}%` }} /></span>
              <span className="tnum text-right font-medium">{b.rate === null ? "n/a" : `${b.rate}%`}</span>
            </button>
          </li>
        ))}
      </ul>
      {!d.appointmentsRecorded && <p className="t-small t-quiet mt-2">No appointments are recorded yet, so every group shows no bookings.</p>}
      {open && (() => {
        const b = d.buckets.find((x) => x.key === open);
        if (!b) return null;
        return (
          <SidePopup label={`Bookings: ${b.label}`} onClose={() => setOpen(null)}>
            <div data-testid="booking-popup">
              <h3 className="t-title">{b.label}</h3>
              <p className="t-small t-quiet mt-1">First person reply, from the moment the lead arrived.</p>
              <dl className="mt-4 grid grid-cols-3 gap-4 text-sm">
                <div><dt className="t-label">Leads</dt><dd className="text-2xl font-semibold tabular-nums">{b.leads}</dd></div>
                <div><dt className="t-label">Booked</dt><dd className="text-2xl font-semibold tabular-nums">{b.booked}</dd></div>
                <div><dt className="t-label">Rate</dt><dd className="text-2xl font-semibold tabular-nums">{b.rate === null ? "n/a" : `${b.rate}%`}</dd></div>
              </dl>
              {!b.enough && <p className="t-small t-quiet mt-3">Fewer than 10 leads, so no rate is shown. A small group says nothing reliable.</p>}
              <p className="t-small t-quiet mt-3">Booked means an appointment that was not cancelled, made for the person after the lead arrived and within {d.bookWithinDays} days.</p>
            </div>
          </SidePopup>
        );
      })()}
    </section>
  );
}

// ---------------------------------------------------------------- money-at-risk meter (Race)
export type Risk = { counted: number; estimate: number | null; waiting: number; bookingGapKnown: boolean; multiple: number | null; estimateNote: string | null };

export function MoneyMeter({ risk, losing, waiting }: { risk: Risk | null; losing: number; waiting: number }) {
  const [open, setOpen] = useState(false);
  if (!risk) return null;
  const share = waiting === 0 ? 0 : Math.min(100, Math.round((losing / waiting) * 100));
  return (
    <div className="mt-3 max-w-xl" data-testid="money-meter">
      <button type="button" onClick={() => setOpen(true)} data-tip="Money at risk now. Click for how it is worked out." className="ds-press w-full cursor-pointer rounded-md py-1 text-left focus-visible:outline-2 focus-visible:outline-[var(--ring)]">
        <span className="flex items-baseline justify-between gap-3 text-sm"><span className="t-label">Money at risk now</span><span className="tnum font-semibold" data-testid="meter-counted">{usd(risk.counted)}{risk.estimate !== null ? <span className="t-quiet font-normal"> · est. {usd(risk.estimate)}</span> : null}</span></span>
        <span className="mt-1 block h-2 rounded-full bg-[var(--t-raise)]" aria-hidden><span className="block h-2 rounded-full bg-[var(--t-accent)]" style={{ width: `${share}%` }} /></span>
        <span className="t-small t-quiet mt-0.5 block">{losing} of {waiting} waiting {waiting === 1 ? "lead is" : "leads are"} past the target</span>
      </button>
      {open && (
        <SidePopup label="Money at risk" onClose={() => setOpen(false)}>
          <div data-testid="meter-popup">
            <h3 className="t-title">Money at risk now</h3>
            <p className="mt-3 text-sm"><strong className="tnum">{usd(risk.counted)}</strong> is the open deals of the people past the target (counted, a fact).</p>
            <p className="mt-2 text-sm">{risk.estimate !== null ? <><strong className="tnum">{usd(risk.estimate)}</strong> is an estimate: {risk.waiting} waiting leads x the booking drop from slow replies ({risk.multiple}x) x the account&apos;s own average deal.</> : <>No estimate yet. {risk.estimateNote}</>}</p>
          </div>
        </SidePopup>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- duplicate and repeat chips (Race)
export type DupInfo = { contactId: string; name: string; score: number; tier: string; reasons: string[]; url?: string } | null;

export function DupChips({ dup, repeat }: { dup: DupInfo; repeat: boolean }) {
  const [open, setOpen] = useState(false);
  if (!dup && !repeat) return null;
  const chip = "inline-flex min-h-7 items-center rounded-full border px-2 text-xs font-medium";
  return (
    <span className="mt-1 flex flex-wrap items-center gap-1.5" data-testid="dup-chips">
      {dup && <button type="button" onClick={() => setOpen(true)} className={`${chip} ds-press cursor-pointer hover:border-primary/40`} data-testid="dup-chip" data-tip={`Looks like ${dup.name} (${dup.reasons.join(", ") || "same details"}). Reply to the older record.`}>Possible duplicate of {dup.name}</button>}
      {repeat && <span className={chip} data-testid="repeat-chip" data-tip="The same person asked again. That is a warm lead, so it moved up.">Repeat enquirer</span>}
      {open && dup && (
        <SidePopup label="Possible duplicate" onClose={() => setOpen(false)}>
          <div data-testid="dup-popup">
            <h3 className="t-title">Possible duplicate of {dup.name}</h3>
            <p className="t-small t-quiet mt-1">Match {dup.score} of 100 ({dup.tier}). {dup.reasons.join(", ")}.</p>
            <p className="mt-3 text-sm">Reply to the older record: it holds the history. SubSync changes nothing here.</p>
            <p className="mt-4 flex flex-wrap gap-2">
              {dup.url && <a className={BTN} href={dup.url} target="_blank" rel="noopener noreferrer" data-testid="dup-open-older">Open the older record</a>}
              <a className={BTN} href="#cleanup" data-testid="dup-cleanup">Check in Clean-up</a>
            </p>
          </div>
        </SidePopup>
      )}
    </span>
  );
}

// ---------------------------------------------------------------- the escalation ladder (Rules)
type Ladder = { enabled: boolean; nextAfterMin: number; managerAfterMin: number };
type Preview = {
  now: number; ladderReady: boolean; ladder: Ladder; note: string;
  accounts: Array<{ locationId: string; name: string; targetMinutes: number; waiting: number; topStep: number; wouldSay: string | null }>;
  leads: Array<{ locationId: string; contactId: string; name: string; account: string; waitedMin: number; targetMin: number; step: number; stepWords: string; owner: string | null; nextPerson: string | null; toNext: number | null }>;
};

export function LadderCard({ canChange }: { canChange: boolean }) {
  const api = useApiClient();
  const { data: d, error, reload } = useData<Preview>("speed?part=ladder");
  const [edit, setEdit] = useState<Partial<Ladder>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [pick, setPick] = useState<Preview["leads"][number] | null>(null);
  const form: Ladder | null = d ? { ...d.ladder, ...edit } : null;
  const setForm = (next: Ladder) => setEdit(next);
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!d || !form) return <SkeletonRows rows={3} label="Building the preview..." />;
  const save = async () => {
    setMsg(null);
    try { await api.put("speed/ladder", form); setMsg("Saved."); setEdit({}); reload(); } catch (e) { setMsg((e as Error).message || "Could not save."); }
  };
  const num = (k: "nextAfterMin" | "managerAfterMin") => (
    <input type="number" min={1} max={1440} value={form[k]} disabled={!canChange} aria-label={k === "nextAfterMin" ? "Minutes past the target before the next person is told" : "Minutes past the target before the manager is told"}
      onChange={(e) => setForm({ ...form, [k]: Number(e.target.value) })} className="h-9 w-20 rounded-md border bg-card px-2 text-sm tabular-nums" data-testid={k === "nextAfterMin" ? "ladder-next" : "ladder-manager"} />
  );
  return (
    <section className="spd-rise mb-10 border-t border-[var(--t-rule)] pt-5" aria-labelledby="ladder" data-testid="ladder-card">
      <h3 id="ladder" className="t-title mb-2">When nobody replies <WhatIs text="A lead past its account's own reply target tells the owner. If it is still waiting, the next person in line is told, then a manager. The waiting time already skips closed hours when business hours are on." /></h3>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm" data-testid="ladder-form">
        <label className="inline-flex min-h-9 items-center gap-2"><input type="checkbox" checked={form.enabled} disabled={!canChange} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} data-testid="ladder-enabled" />Escalate</label>
        <span>next person after {num("nextAfterMin")} min,</span><span>manager after {num("managerAfterMin")} min</span><span className="t-quiet">past the target</span>
        {canChange && <button type="button" className={BTN} onClick={() => void save()} data-testid="ladder-save">Save</button>}
        {msg && <span role="status" className="t-small">{msg}</span>}
      </div>
      {!d.ladderReady && <p className="t-small t-quiet mt-2" data-testid="ladder-notready">Saving needs the latest database update. The standard ladder (15 and 45 minutes) applies until then.</p>}
      <h4 className="t-label mb-1 mt-5">What the alert would say now <WhatIs text="A dry run. Each account is judged against its own reply target. Nothing is sent from here; real messages follow the switches in Settings." /></h4>
      {d.accounts.filter((a) => a.waiting > 0).length === 0 ? <p className="t-small t-quiet" data-testid="ladder-empty">No account has a lead past its target right now.</p> : (
        <ul className="space-y-1 text-sm" data-testid="ladder-accounts">
          {d.accounts.filter((a) => a.waiting > 0).slice(0, 8).map((a) => <li key={a.locationId} data-testid="ladder-account"><span className="t-quiet">Target {a.targetMinutes} min.</span> {a.wouldSay}</li>)}
        </ul>
      )}
      {d.leads.length > 0 && (
        <ul className="mt-3 divide-y border-y text-sm" data-testid="ladder-leads">
          {d.leads.slice(0, 8).map((l) => (
            <li key={`${l.locationId}:${l.contactId}`}>
              <button type="button" onClick={() => setPick(l)} data-testid="ladder-lead" data-tip={`Waiting ${l.waitedMin} min. ${l.stepWords}.`} className="ds-press flex min-h-11 w-full cursor-pointer items-center justify-between gap-3 py-1 text-left hover:bg-[var(--t-raise)] focus-visible:outline-2 focus-visible:outline-[var(--ring)]">
                <span className="truncate font-medium"><LeadMark name={l.name} />{l.name}<LeadTag /></span><span className="t-small t-quiet shrink-0">Step {l.step} of 3 · {humanWait(l.waitedMin)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {pick && (
        <SidePopup label="Escalation" onClose={() => setPick(null)}>
          <div data-testid="ladder-popup">
            <h3 className="t-title">{pick.name}</h3>
            <p className="t-small t-quiet">{pick.account} · waiting {humanWait(pick.waitedMin)}, target {pick.targetMin} min</p>
            <ol className="mt-4 space-y-2 text-sm">
              <li className={pick.step >= 1 ? "font-semibold" : ""}>1. The owner is told{pick.owner ? `: ${pick.owner}` : " (nobody owns this lead)"}</li>
              <li className={pick.step >= 2 ? "font-semibold" : ""}>2. The next person is told{pick.nextPerson ? `: ${pick.nextPerson}` : ""}</li>
              <li className={pick.step >= 3 ? "font-semibold" : ""}>3. A manager is told</li>
            </ol>
            {pick.toNext !== null && <p className="t-small t-quiet mt-3">The next step comes in {pick.toNext} min if nobody replies.</p>}
          </div>
        </SidePopup>
      )}
    </section>
  );
}
