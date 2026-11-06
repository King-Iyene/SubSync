"use client";

import { Clock, Flame, Minus, Plus, Timer } from "lucide-react";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { clampCadence, DEFAULT_CADENCE, DEFAULT_GOALS, hourWord, sanitizeDispositions, type BoardRow, type Cadence, type Disposition, type Goals, type NextStep } from "@/lib/dial/dial6";
import { CountUp, Q } from "./speed6-base";
import "./speed6.css";

// Call mode v2, the screen pieces (stage SPEED6): the redial plan, the power hour, the setter board, and the small stores that keep a person's choices in THIS browser (cadence, goals, booking link,
// scripts per source, outcomes per account, promised callbacks). Nothing here places a call or sends a message.

// ---------------------------------------------------------------- choices kept in this browser
export function useLocal<T>(key: string, initial: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => { try { const raw = typeof window === "undefined" ? null : window.localStorage.getItem(key); return raw ? (JSON.parse(raw) as T) : initial; } catch { return initial; } });
  const set = (n: T) => { setV(n); try { window.localStorage.setItem(key, JSON.stringify(n)); } catch { /* kept for this visit only */ } };
  return [v, set];
}
/** Shared choices kept on the server (speed_prefs) once the migration has run; until then, and for a person who cannot change them, this browser keeps them (the old behaviour). */
export const PrefsCtx = createContext<{ ready: boolean; map: Record<string, unknown>; put: (key: string, scope: string, value: unknown) => void } | null>(null);
export function usePref<T>(key: string, scope: string, legacyKey: string, initial: T, clean: (raw: unknown) => T): [T, (v: T) => void] {
  const ctx = useContext(PrefsCtx);
  const [local, setLocal] = useLocal<T>(legacyKey, initial);
  const server = ctx?.ready ? ctx.map[`${scope}|${key}`] : undefined;
  return [server !== undefined ? clean(server) : clean(local), (n: T) => { setLocal(n); ctx?.put(key, scope, n); }];
}
export const useCadence = () => { const [c, set] = usePref<Cadence>("cadence", "", "subsync.dial.cadence", DEFAULT_CADENCE, (r) => clampCadence((r ?? {}) as Partial<Cadence>)); return [c, (n: Cadence) => set(clampCadence(n))] as const; };
export const useGoals = () => usePref<Goals>("goals", "", "subsync.dial.goals", DEFAULT_GOALS, (r) => ({ ...DEFAULT_GOALS, ...((r ?? {}) as Partial<Goals>) }));
export const useScripts = () => usePref<Record<string, string>>("scripts", "", "subsync.dial.scripts", {}, (r) => (r && typeof r === "object" ? (r as Record<string, string>) : {}));
export type SavedCallback = { key: string; name: string; at: number; phone: string | null; locationId: string; contactId: string; locationName: string | null; timeZone: string | null; url: string };
export const useCallbacks = () => useLocal<SavedCallback[]>("subsync.dial.callbacks", []);
export const useDispositions = (locationId: string | null) => usePref<Disposition[]>("dispositions", locationId ?? "", `subsync.dial.dispo.${locationId ?? "all"}`, sanitizeDispositions(null), sanitizeDispositions);

// ---------------------------------------------------------------- rings and the power hour
export function Ring6({ pct, size = 76, label, tone = "var(--s6-cyan)", children }: { pct: number; size?: number; label: string; tone?: string; children?: ReactNode }) {
  const r = (size - 10) / 2; const c = 2 * Math.PI * r;
  return (
    <div className="s6-ring text-center" style={{ width: size }} role="img" aria-label={`${label}: ${pct}%`}>
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(36,54,89,0.9)" strokeWidth="6" />
          <circle className="arc" cx={size / 2} cy={size / 2} r={r} fill="none" stroke={tone} strokeWidth="6" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - Math.min(100, pct) / 100)} transform={`rotate(-90 ${size / 2} ${size / 2})`} style={{ filter: pct >= 100 ? `drop-shadow(0 0 6px ${tone})` : undefined }} />
        </svg>
        <div className="absolute inset-0 grid place-items-center text-sm font-semibold tabular-nums">{children}</div>
      </div>
      <p className="s6-label mt-1">{label}</p>
    </div>
  );
}
const mmss = (ms: number) => { const s = Math.ceil(ms / 1000); return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`; };
/** A ticking clock for a timed session. The tick runs from an interval callback, so nothing re-renders more than once a second. */
export function useTick(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { if (!active) return; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [active]);
  return now;
}
export function PowerBar({ msLeft, over, streak, rings, goals, calls, reached, booked }: { msLeft: number; over: boolean; streak: number; rings: { calls: number; reached: number; booked: number }; goals: Goals; calls: number; reached: number; booked: number }) {
  return (
    <div className="s6-card mb-4 !p-4" data-glow={over ? undefined : "active"} data-testid="power-bar">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex items-center gap-2"><Timer aria-hidden className="size-5 text-[var(--s6-cyan)]" /><span className="s6-big !text-[1.75rem]" data-testid="power-clock" aria-label={over ? "Time is up" : `${mmss(msLeft)} left`}>{over ? "Time" : mmss(msLeft)}</span></div>
        <div className="flex gap-3">
          <Ring6 size={64} pct={rings.calls} label={`${calls}/${goals.calls} calls`}>{calls}</Ring6>
          <Ring6 size={64} pct={rings.reached} tone="var(--s6-violet)" label={`${reached}/${goals.reached} reached`}>{reached}</Ring6>
          <Ring6 size={64} pct={rings.booked} tone="var(--s6-lime)" label={`${booked}/${goals.booked} booked`}>{booked}</Ring6>
        </div>
        {streak >= 3 && <span className="s6-chip" data-tone="amber" data-testid="power-streak"><Flame aria-hidden className="size-3.5" />{streak} reached in a row</span>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- the setter board
const TIER_TONE = { Orbit: "cyan", Surge: "violet", Spark: "amber" } as const;
/** Rows slide to their new place when the rank changes (a short transform, off with reduced motion); numbers count up; the top three glow. */
export function Board6({ rows, own }: { rows: BoardRow[]; own: { rank: number; of: number } | null }) {
  const prev = useRef(new Map<string, number>());
  const [shift, setShift] = useState<Record<string, number>>({});
  const sig = rows.map((r) => `${r.id}:${r.rank}`).join(",");
  useEffect(() => {
    const moved: Record<string, number> = {};
    for (const r of rows) { const p = prev.current.get(r.id); if (p !== undefined && p !== r.rank) moved[r.id] = (p - r.rank) * 64; }
    prev.current = new Map(rows.map((r) => [r.id, r.rank]));
    if (Object.keys(moved).length === 0) return;
    const a = requestAnimationFrame(() => { setShift(moved); requestAnimationFrame(() => setShift({})); });
    return () => cancelAnimationFrame(a);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);
  const top = Math.max(1, ...rows.map((r) => r.calls)); const topR = Math.max(1, ...rows.map((r) => r.reached)); const topB = Math.max(1, ...rows.map((r) => r.booked));
  return (
    <Q q="Who is on top this week?" testId="board-card" tip="Booked counts most, then reached, then calls, over the last 7 days of calls logged in Call mode. Orbit is first place, Surge second and third, Spark the rest. The lime mark is the fastest typical answer.">
      {rows.length === 0 ? <p className="s6-label" data-testid="board-empty">Nobody has logged a call this week yet. Start a session to get on the board.</p> : (
        <ol className="s6-board" data-testid="board">
          {rows.map((r) => (
            <li key={r.id} data-tier={r.tier} data-testid="board-row" style={shift[r.id] ? { transform: `translateY(${shift[r.id]}px)`, transition: "none" } : undefined}>
              <span className="s6-rank" aria-label={`Rank ${r.rank}`}>{r.rank}</span>
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 font-semibold"><span className="truncate">{r.name}</span><span className="s6-chip" data-tone={TIER_TONE[r.tier]}>{r.tier}</span>{r.fastest && <span className="s6-chip s6-fast">Fastest</span>}</p>
                <div className="grid grid-cols-3 gap-2">
                  {([["calls", r.calls, top, "var(--s6-cyan)"], ["reached", r.reached, topR, "var(--s6-violet)"], ["booked", r.booked, topB, "var(--s6-magenta)"]] as const).map(([k, n, mx, col]) => (
                    <div key={k}><div className="s6-meter"><i style={{ width: `${(n / mx) * 100}%`, background: col }} /></div><p className="s6-label"><b className="tnum text-[var(--t-ink)]"><CountUp value={n} /></b> {k}</p></div>
                  ))}
                </div>
              </div>
              <span className="s6-big !text-[1.5rem]" aria-label={`${r.score} points`}><CountUp value={r.score} /></span>
            </li>
          ))}
        </ol>
      )}
      {own && rows.length === 1 && <p className="s6-label mt-3" data-testid="board-own">You are number {own.rank} of {own.of} this week.</p>}
    </Q>
  );
}

// ---------------------------------------------------------------- the redial plan
export function CadenceCard({ cadence, set }: { cadence: Cadence; set: (c: Cadence) => void }) {
  const step = (k: "maxAttempts" | "redialAfterHours", d: 1 | -1) => set({ ...cadence, [k]: cadence[k] + d });
  const stepper = (k: "maxAttempts" | "redialAfterHours", label: string, unit: string) => (
    <div className="grid gap-1"><span className="s6-label">{label}</span>
      <div className="s6-stepper" role="group" aria-label={label}><button type="button" aria-label={`Fewer ${unit}`} onClick={() => step(k, -1)}><Minus aria-hidden className="mx-auto size-4" /></button><output data-testid={`cad-${k}`}>{cadence[k]} {unit}</output><button type="button" aria-label={`More ${unit}`} onClick={() => step(k, 1)}><Plus aria-hidden className="mx-auto size-4" /></button></div></div>
  );
  return (
    <Q q="How often do we try again?" testId="cadence-card" sub="Each lead gets a few tries, spaced out, and then a text task." tip="After a call with no answer, the lead comes back for another try after the wait you choose (or the next morning in their time). After the last try the plan stops calling and asks for a text instead. Kept in this browser.">
      <div className="flex flex-wrap items-end gap-6">
        {stepper("maxAttempts", "Tries before a text", "tries")}
        {stepper("redialAfterHours", "Wait between tries", "hours")}
        <div className="flex items-center gap-3"><button type="button" role="switch" aria-checked={cadence.nextDay} aria-label="Call again the next morning" className="s6-toggle" onClick={() => set({ ...cadence, nextDay: !cadence.nextDay })} data-testid="cad-nextday" /><span className="text-sm">Next morning instead</span></div>
      </div>
    </Q>
  );
}

export function BestHourCard({ best }: { best: { hour: number; rate: number; tries: number } | null }) {
  return (
    <Q q="When do people pick up?" testId="besthour-card" tip="The hour of day in which the most of your logged calls reached a person. Needs 12 logged calls and 3 in the hour; otherwise nothing is guessed.">
      {best === null ? <p className="s6-label" data-testid="besthour-empty">Needs 12 logged calls. Keep calling and this fills in.</p> : <><p className="s6-big" data-tone="cyan" data-testid="besthour-value">{hourWord(best.hour)}</p><p className="s6-label mt-1">{best.rate}% reached, from {best.tries} calls in that hour.</p></>}
    </Q>
  );
}
export function AttemptCard({ rows }: { rows: Array<{ attempt: number; leads: number; booked: number; rate: number | null }> }) {
  const top = Math.max(1, ...rows.map((r) => r.booked));
  return (
    <Q q="Which attempt books?" testId="attempt-card" tip="For each try number: how many leads got that many calls and how many booked on that call. A rate needs 10 leads at that try.">
      {rows.length === 0 ? <p className="s6-label" data-testid="attempt-empty">Needs logged calls. Nothing yet.</p> : (
        <ul className="grid gap-3">{rows.map((r) => (
          <li key={r.attempt} data-testid="attempt-row"><div className="flex items-baseline justify-between text-sm"><span className="font-medium">Try {r.attempt}</span><span className="tnum">{r.booked} booked of {r.leads}{r.rate !== null ? ` (${r.rate}%)` : ""}</span></div>
            <div className="s6-hbar mt-1"><i style={{ width: `${Math.max(2, (r.booked / top) * 100)}%`, background: "var(--s6-magenta)" }} /></div></li>
        ))}</ul>
      )}
    </Q>
  );
}
export function ActivityCard({ rows }: { rows: Array<{ locationId: string; name: string; calls: number; reached: number; booked: number; last: number }> }) {
  return (
    <Q q="Which clients are being called?" testId="activity-card" tip="Calls logged in Call mode over the last 7 days, per client account.">
      {rows.length === 0 ? <p className="s6-label">No calls logged this week.</p> : (
        <table className="s6-table"><thead><tr><th scope="col">Client</th><th scope="col">Calls</th><th scope="col">Reached</th><th scope="col">Booked</th></tr></thead><tbody>{rows.map((r) => <tr key={r.locationId} data-testid="activity-row"><td className="font-medium">{r.name}</td><td>{r.calls}</td><td>{r.reached}</td><td>{r.booked}</td></tr>)}</tbody></table>
      )}
    </Q>
  );
}

// ---------------------------------------------------------------- outcomes per account (custom dispositions)
const NEXT_LABEL: Record<NextStep, string> = { next: "Go to the next lead", redial: "Try again later", callback: "Ask for a callback time", stop: "Stop calling this lead" };
export function DispositionEditor({ value, onChange, accountName }: { value: Disposition[]; onChange: (d: Disposition[]) => void; accountName: string | null }) {
  const upd = (i: number, p: Partial<Disposition>) => onChange(value.map((d, k) => (k === i ? { ...d, ...p } : d)));
  return (
    <details className="mt-4 border-t border-[rgba(36,54,89,0.9)] pt-3" data-testid="dispo-editor">
      <summary className="min-h-9 cursor-pointer text-sm font-medium">Customize the outcomes{accountName ? ` for ${accountName}` : ""}</summary>
      <ul className="mt-3 grid gap-3">
        {value.map((d, i) => (
          <li key={d.key} className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
            <label className="grid gap-1 text-xs"><span className="s6-label">Name</span><input className="s6-num !w-full !text-left px-2" value={d.label} maxLength={40} onChange={(e) => upd(i, { label: e.target.value })} aria-label={`Name of outcome ${i + 1}`} /></label>
            <label className="grid gap-1 text-xs"><span className="s6-label">Then</span><select className="s6-num !w-full px-2" value={d.next} onChange={(e) => upd(i, { next: e.target.value as NextStep })} aria-label={`What happens after ${d.label}`}>{(Object.keys(NEXT_LABEL) as NextStep[]).map((n) => <option key={n} value={n}>{NEXT_LABEL[n]}</option>)}</select></label>
            <label className="grid gap-1 text-xs"><span className="s6-label">Add this tag</span><input className="s6-num !w-full !text-left px-2" value={d.tag ?? ""} maxLength={60} placeholder="none" onChange={(e) => upd(i, { tag: e.target.value || null })} aria-label={`Tag for ${d.label}`} /></label>
            <label className="flex min-h-10 items-center gap-2 text-xs"><input type="checkbox" checked={d.doNotCall} onChange={(e) => upd(i, { doNotCall: e.target.checked })} />Do not call again</label>
          </li>
        ))}
      </ul>
      <p className="s6-label mt-2">A tag is added to the lead in your CRM (a dry run while writing is off). &quot;Do not call again&quot; skips the lead here and tags it do-not-call; the CRM&apos;s own do-not-disturb flag is not changed by SubSync.</p>
      <button type="button" className="s6-btn mt-2" onClick={() => onChange(sanitizeDispositions(null))} data-testid="dispo-reset"><Clock aria-hidden className="size-4" />Back to the standard outcomes</button>
    </details>
  );
}
