"use client";

import { useState } from "react";
import { MUTE_WORDS, type MuteKind } from "@/lib/analytics/clients-actions";
import { useApiClient, useData } from "../../session";
import { SkeletonRows } from "../../ds";
import { fixturesOn, notSwitchedOn } from "./data";

// Quiet marks, one reply target and who looks after a client (slice CB routes under /api/app/clients/act). SubSync-only settings: nothing here is written to the CRM or sent to anyone.
// The account id comes from a row the server already returned; the server checks it again (ownedLocation) and never echoes it back.
type MuteData = { ready: boolean; mutes: Array<{ id: string; locationId: string; kind: MuteKind; until: number }>; days: number[] };
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function AccountSettings({ id, name, onClose, onChanged }: { id: string; name: string; onClose: () => void; onChanged: () => void }) {
  const api = useApiClient(), sample = fixturesOn();
  const mutes = useData<MuteData>(sample ? null : "clients/act/mutes");
  const [msg, setMsg] = useState<string | null>(null), [err, setErr] = useState<string | null>(null), [minutes, setMinutes] = useState(""), [owner, setOwner] = useState("");
  const mine = mutes.data?.mutes.filter((m) => m.locationId === id) ?? [];
  const run = async (fn: () => Promise<{ message?: string }>) => {
    setErr(null);
    if (sample) return setErr("Sample data cannot be changed.");
    try { const r = await fn(); setMsg(r.message ?? "Done."); mutes.reload(); onChanged(); } catch (e) { setErr(e instanceof Error ? e.message : "That did not work."); }
  };
  const off = notSwitchedOn(mutes.error);
  return (
    <section className="cl-drill print:hidden" data-testid="cl-settings" aria-label={`Settings for ${name}`}>
      <div className="mb-2 flex flex-wrap items-center gap-3"><h3 className="text-base font-semibold">Settings: {name}</h3><span className="ap-fine">Only changes what SubSync shows you. Nothing is changed in your CRM and nobody is messaged.</span><button type="button" className="ap-link ml-auto" onClick={onClose}>Close</button></div>
      {sample && <p className="ap-fine" role="status">Sample data: these buttons are switched off.</p>}
      {mutes.loading && !mutes.data && !sample && <SkeletonRows rows={2} label="Loading settings..." />}
      {off ? <p className="ap-fine">Settings are not switched on for your account yet.</p> : (
        <div className="grid gap-6 sm:grid-cols-2">
          <div>
            <p className="mb-1 text-sm font-medium">Quiet for a while</p>
            <p className="ap-fine mb-2">Hides one kind of attention for this client in the ranking. The real counts stay visible.</p>
            {(Object.keys(MUTE_WORDS) as MuteKind[]).map((k) => (
              <div key={k} className="mb-1 flex flex-wrap items-center justify-between gap-2"><span className="text-sm">{MUTE_WORDS[k]}</span>
                <span className="flex gap-1">{(mutes.data?.days ?? [7, 30]).map((d) => <button key={d} type="button" className="s6-btn" title={`Quiet for ${d} days`} onClick={() => void run(() => api.post("clients/act/mute", { location: id, kind: k, days: d }))}>{d}d</button>)}</span></div>
            ))}
            {mine.length > 0 && <p className="ap-fine mt-2">Quiet now: {mine.map((m) => <span key={m.id}>{MUTE_WORDS[m.kind]} until {day(m.until)} <button type="button" className="ap-link" onClick={() => void run(() => api.post("clients/act/unmute", { id: m.id }))}>Undo</button>{" "}</span>)}</p>}
          </div>
          <div>
            <label htmlFor={`cl-t-${id}`} className="mb-1 block text-sm font-medium">Reply target (minutes)</label>
            <p className="ap-fine mb-2">How fast a new lead should get a reply for this client. Leave empty to use your default.</p>
            <div className="flex flex-wrap gap-2">
              <input id={`cl-t-${id}`} className="ap-field w-28" inputMode="numeric" value={minutes} onChange={(e) => setMinutes(e.target.value.replace(/\D/g, "").slice(0, 4))} />
              <button type="button" className="s6-btn" data-kind="primary" onClick={() => void run(() => api.post("clients/act/target", { location: id, minutes: minutes === "" ? null : Number(minutes) }))}>Save</button>
              <button type="button" className="s6-btn" onClick={() => void run(() => api.post("clients/act/target-undo", { location: id }))}>Undo last change</button>
            </div>
            <label htmlFor={`cl-o-${id}`} className="mb-1 mt-4 block text-sm font-medium">Looked after by</label>
            <p className="ap-fine mb-2">The person on your team who owns this client. Only your team sees it.</p>
            <div className="flex flex-wrap gap-2">
              <input id={`cl-o-${id}`} className="ap-field w-48" maxLength={60} value={owner} onChange={(e) => setOwner(e.target.value)} />
              <button type="button" className="s6-btn" data-kind="primary" onClick={() => void run(() => api.post("clients/act/owner", { location: id, owner: owner.trim() === "" ? null : owner.trim() }))}>Save</button>
            </div>
          </div>
        </div>
      )}
      <div aria-live="polite" className="mt-3 min-h-5 text-sm">{err ? <span role="alert">{err}</span> : msg}</div>
    </section>
  );
}
