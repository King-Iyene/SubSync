"use client";

import { Bell, Copy, Minus, Plus, Send } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { digestPreview } from "@/lib/analytics/speed-v3";
import type { GapMap, TrendNormal } from "@/lib/analytics/speed-v3";
import { useApiClient, useData } from "../session";
import { ErrorState, LeadDrawer, SkeletonRows, type LeadSeed } from "../ds";
import { useSpeedFilter } from "./speed-filter";
import { SidePopup } from "./speed-popup";
import { Fold, Q } from "./speed6-base";
import type { GoFn } from "../nav";
import "./speed6.css";

// Rules, made simple (stage SPEED6): a stepper for the reply target, a toggle for escalation, the digest as a card with a message preview, and the leads waiting right now as cards. Nothing here
// sends anything: "Send test" is a dry run while sending is switched off in Settings.

const stepOf = (n: number, dir: 1 | -1) => { const s = n < 10 ? 1 : n < 60 ? 5 : 15; return Math.min(1440, Math.max(1, n + dir * s)); };

export function TargetCard({ targetMinutes, canChange }: { targetMinutes: number; canChange: boolean }) {
  const api = useApiClient();
  const [v, setV] = useState(targetMinutes);
  const [saved, setSaved] = useState(targetMinutes);
  const [msg, setMsg] = useState<string | null>(null);
  const save = async () => { setMsg(null); try { await api.put("settings", { speedTargetMinutes: v }); setSaved(v); setMsg("Saved."); } catch (e) { setMsg((e as Error).message || "Could not save."); } };
  return (
    <Q sticky q="How fast must we reply?" testId="target-card" glow="active" sub="A new lead should hear from a person within this many minutes." tip="This is the default for every client account. An account can have its own target in Settings. Automatic messages do not stop the clock.">
      <div className="flex flex-wrap items-center gap-4">
        <div className="s6-stepper" role="group" aria-label="Reply target in minutes">
          <button type="button" aria-label="Fewer minutes" disabled={!canChange} onClick={() => setV(stepOf(v, -1))} data-testid="target-minus"><Minus aria-hidden className="mx-auto size-5" /></button>
          <output aria-live="polite" data-testid="target-value">{v} min</output>
          <button type="button" aria-label="More minutes" disabled={!canChange} onClick={() => setV(stepOf(v, 1))} data-testid="target-plus"><Plus aria-hidden className="mx-auto size-5" /></button>
        </div>
        {canChange && v !== saved && <button type="button" className="s6-btn" data-kind="primary" onClick={() => void save()} data-testid="target-save">Save</button>}
        {msg && <span role="status" className="s6-label">{msg}</span>}
        {!canChange && <span className="s6-label">Ask the person who manages your account to change it.</span>}
      </div>
    </Q>
  );
}

type Ladder = { enabled: boolean; nextAfterMin: number; managerAfterMin: number };
type Waiting = { locationId: string; contactId: string; name: string; account: string; waitedMin: number; targetMin: number; step: number; stepWords: string; owner: string | null; nextPerson: string | null; toNext: number | null; url?: string };
type Preview = { ladderReady: boolean; ladder: Ladder; leads: Waiting[] };

export function EscalationCard({ canChange, d, reload }: { canChange: boolean; d: Preview; reload: () => void }) {
  const api = useApiClient();
  const [edit, setEdit] = useState<Partial<Ladder>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const f: Ladder = { ...d.ladder, ...edit };
  const dirty = Object.keys(edit).length > 0;
  const save = async () => { setMsg(null); try { await api.put("speed/ladder", f); setMsg("Saved."); setEdit({}); reload(); } catch (e) { setMsg((e as Error).message || "Could not save."); } };
  const num = (k: "nextAfterMin" | "managerAfterMin", label: string, id: string) => (
    <label className="grid gap-1 text-sm"><span className="s6-label">{label}</span>
      <span className="flex items-center gap-2"><input type="number" min={1} max={1440} className="s6-num" value={f[k]} disabled={!canChange || !f.enabled} aria-label={label} data-testid={id} onChange={(e) => setEdit({ ...edit, [k]: Number(e.target.value) })} /><span className="s6-label">min</span></span></label>
  );
  return (
    <Q sticky q="Who gets told when nobody replies?" testId="ladder-card" tip="Past the account's reply target, the owner is told. If it is still waiting, the next person in line is told, then a manager. The waiting time skips closed hours when business hours are on.">
      <div className="mb-4 flex items-center gap-3">
        <button type="button" role="switch" aria-checked={f.enabled} aria-label="Escalate to the next person and a manager" className="s6-toggle" disabled={!canChange} onClick={() => setEdit({ ...edit, enabled: !f.enabled })} data-testid="ladder-enabled" />
        <span className="font-medium">{f.enabled ? "Escalation is on" : "Escalation is off"}</span>
      </div>
      <div className="flex flex-wrap gap-6">{num("nextAfterMin", "Next person after", "ladder-next")}{num("managerAfterMin", "Manager after", "ladder-manager")}</div>
      <p className="s6-label mt-2">Minutes after the reply target is missed.</p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        {canChange && <button type="button" className="s6-btn" data-kind={dirty ? "primary" : undefined} disabled={!dirty} onClick={() => void save()} data-testid="ladder-save">Save</button>}
        {msg && <span role="status" className="s6-label">{msg}</span>}
        {!d.ladderReady && <span className="s6-label" data-testid="ladder-notready">Saving needs the latest database update. The standard 15 and 45 minutes apply until then.</span>}
      </div>
    </Q>
  );
}

/** "Leads waiting now": each lead past its target as a card; the badge says how far up the ladder it is. A click opens the shared lead panel, never a small popup. */
export function WaitingNowCard({ leads, multi }: { leads: Waiting[]; multi: boolean }) {
  const [open, setOpen] = useState<{ i: number; reply: boolean } | null>(null);
  const seeds: LeadSeed[] = useMemo(() => leads.map((l) => ({ contactId: l.contactId, locationId: l.locationId, name: l.name, locationName: l.account, url: l.url, owner: l.owner, unassigned: !l.owner, note: `Waiting ${l.waitedMin} minutes, target ${l.targetMin}. ${l.stepWords}.` })), [leads]);
  const shown = leads.slice(0, 9);
  return (
    <Q sticky q="Which leads are waiting now?" testId="waiting-now" glow={shown.length ? "urgent" : undefined} tip="Leads past their account's reply target, newest worry first. The step badge says whether the owner, the next person or a manager has been told.">
      {shown.length === 0 ? <p className="s6-label" data-testid="ladder-empty">No lead is past its target right now.</p> : (
        <div className="s6-wait" data-testid="ladder-leads">
          {shown.map((l, i) => (
            <article key={`${l.locationId}:${l.contactId}`} className="rounded-xl border border-[rgba(36,54,89,0.9)] bg-[rgba(13,23,48,0.7)] p-4" data-testid="ladder-lead">
              <div className="flex items-start justify-between gap-2"><button type="button" className="s6-link min-w-0 font-semibold" onClick={() => setOpen({ i, reply: false })} data-testid="ladder-lead-open"><span className="block truncate">{l.name}</span>{multi && <span className="s6-label block truncate">{l.account}</span>}</button>
                <span className="s6-step s6-pulse" data-step={l.step} title={l.stepWords}><Bell aria-hidden className="size-3" />Step {l.step} of 3</span></div>
              <p className="s6-big mt-3 !text-[1.75rem]" data-tone={l.step >= 2 ? "red" : "amber"}>{l.waitedMin} <span className="text-sm font-medium">min</span></p>
              <p className="s6-label mt-1">Told: {l.step >= 3 ? "a manager" : l.step === 2 ? (l.nextPerson ?? "the next person") : (l.owner ?? "nobody owns it")}</p>
              <button type="button" className="s6-btn mt-3 w-full" data-kind="primary" onClick={() => setOpen({ i, reply: true })} data-testid="ladder-reply" aria-label={`Reply to ${l.name}`}>Reply</button>
            </article>
          ))}
        </div>
      )}
      {open && <LeadDrawer leads={seeds.map((s, k) => (open.reply && k === open.i ? { ...s, reply: true } : s))} index={open.i} onIndex={(n) => setOpen(n === null ? null : { i: n, reply: false })} onClose={() => setOpen(null)} showAccount={multi} />}
    </Q>
  );
}

export function DigestCard({ who, waiting, dollars, typical }: { who: string; waiting: number; dollars: number | null; typical: string | null }) {
  const { query } = useSpeedFilter();
  const { data: d } = useData<{ trend: TrendNormal; gap: GapMap }>(`speed?part=insights${query}`);
  const [word, setWord] = useState<"daily" | "weekly">("daily");
  const [show, setShow] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const text = useMemo(() => (d ? digestPreview({ who, waiting, dollars, typical, trend: d.trend, gap: d.gap, word }) : ""), [d, who, waiting, dollars, typical, word]);
  return (
    <Q sticky q="What is in my summary email?" testId="digest-card" sub="A short message with who is waiting and how you are doing." tip="Choose daily or weekly. The preview shows what the message would say right now. Send test is a dry run: nothing is sent while sending is switched off.">
      <div className="flex flex-wrap items-center gap-3">
        <span className="inline-flex gap-1 rounded-xl border border-[rgba(103,232,249,0.3)] p-1" role="group" aria-label="How often">
          {(["daily", "weekly"] as const).map((w) => <button key={w} type="button" aria-pressed={word === w} onClick={() => setWord(w)} className="s6-btn !min-h-9 !border-transparent" data-kind={word === w ? "primary" : undefined} data-testid={`digest-${w}`}>{w === "daily" ? "Daily" : "Weekly"}</button>)}
        </span>
        <button type="button" className="s6-btn" onClick={() => setShow(true)} disabled={!d} data-testid="digest-preview-open">Preview {word} message</button>
        <button type="button" className="s6-btn" onClick={() => setMsg("Dry run: a test would go to the people chosen in Alerts. Nothing was sent.")} data-testid="digest-test"><Send aria-hidden className="size-4" />Send test</button>
      </div>
      {msg && <p role="status" className="s6-label mt-3" data-testid="digest-msg">{msg}</p>}
      {show && (
        <SidePopup label={`${word === "daily" ? "Daily" : "Weekly"} message`} onClose={() => setShow(false)}>
          <div data-testid="digest-popup">
            <h3 className="text-lg font-semibold">{word === "daily" ? "Daily" : "Weekly"} message</h3>
            <p className="mt-3 whitespace-pre-line text-[0.95rem] leading-7" data-testid="digest-preview">{text}</p>
            <button type="button" className="mt-4 inline-flex min-h-10 items-center gap-2 rounded-lg border px-3 text-sm font-medium" onClick={() => void navigator.clipboard?.writeText(text)}><Copy aria-hidden className="size-4" />Copy</button>
          </div>
        </SidePopup>
      )}
    </Q>
  );
}

/** The Rules tab: three cards first, the rest behind More (routing check and the printable response-speed report). */
export function RulesTab6(p: { who: string; waiting: number; dollars: number | null; typical: string | null; canChange: boolean; targetMinutes: number; go: GoFn; multi: boolean; rest: ReactNode }) {
  const { data: d, error, reload } = useData<Preview>("speed?part=ladder");
  return (
    <div data-testid="rules-tab">
      <Fold keep={4} testId="rules-fold">
        <div className="s6-grid s6-three">
          <TargetCard targetMinutes={p.targetMinutes} canChange={p.canChange} />
          {error ? <ErrorState error={error} onRetry={reload} /> : !d ? <SkeletonRows rows={3} label="Building the preview..." /> : <EscalationCard canChange={p.canChange} d={d} reload={reload} />}
          <DigestCard who={p.who} waiting={p.waiting} dollars={p.dollars} typical={p.typical} />
        </div>
        {d && <WaitingNowCard leads={d.leads} multi={p.multi} />}
        {p.rest}
      </Fold>
    </div>
  );
}
