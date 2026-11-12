"use client";

import { useState, type ReactNode } from "react";
import { useApiClient, useData } from "../session";
import { WorkflowSetupCard } from "./workflow-setup-card";

// "Send to your CRM call queue" and the Auto call queue card (docs/features/DIALQUEUE.md). SubSync cannot start a call itself; the call queue is your CRM's own dialer. SubSync adds a tag
// (or enrols the lead in a workflow) that you set up once in your CRM, and your CRM's Manual Actions page fills itself. Everything is previewed first, and adding cannot be undone from SubSync.

type Account = { id: string; name: string };
type St = { ready: boolean; accounts: Account[]; canEdit: boolean; queueLinks: Record<string, string>; status: Array<{ locationId: string; line: string; inQueue: number; autoOn: boolean; paused: boolean }> };
type Settings = { route: "tag" | "workflow"; tag: string; workflowId: string | null; autoOn: boolean; paused: boolean; maxPerRun: number; maxPerDay: number; windowStart: number; windowEnd: number };
type Prev = { ok: boolean; message: string; live: boolean; names: Array<{ key: string; name: string; phone: string | null; list: string }>; plan: { skipped: { dnd: number; noPhone: number; outsideHours: number; recent: number; cap: number } } | null };
type Item = { locationId: string; contactId: string };

export const QUEUE_HONESTY = "SubSync cannot start a call itself. The call queue is your CRM's own dialer.";

/** `primary` is the always-live main button of the screen (it can start the review below); `showSend` keeps the plain "Send to your CRM call queue" button when the main button is something else. */
export function CallQueueCard({ list, items, onPickedDone, picked, primary, showSend = true }: { list: string; items: Item[]; picked?: string[]; onPickedDone?: () => void; primary?: (review: () => void, busy: boolean) => ReactNode; showSend?: boolean }) {
  const api = useApiClient();
  const st = useData<St>("dial/cq-status");
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [prev, setPrev] = useState<Array<{ loc: string; name: string; p: Prev }> | null>(null);
  const [busy, setBusy] = useState(false);
  const accounts = st.data?.accounts ?? [];
  const nameOf = (id: string) => accounts.find((a) => a.id === id)?.name ?? "Account";
  const locs = [...new Set(items.map((i) => i.locationId))];
  const keysFor = (loc: string) => (picked && picked.length ? picked.filter((k) => k.startsWith(`${loc}:`)) : items.filter((i) => i.locationId === loc).slice(0, 50).map((i) => `${i.locationId}:${i.contactId}`));
  const link = st.data?.queueLinks?.[locs[0] ?? ""];

  async function review() {
    setBusy(true); setMsg(null);
    try {
      const out = [];
      for (const loc of locs.slice(0, 20)) { const ks = keysFor(loc); if (ks.length) out.push({ loc, name: nameOf(loc), p: await api.post<Prev>("dial/cq-preview", { locationId: loc, list, keys: ks }) }); }
      setPrev(out);
    } catch { setMsg("Could not check the call queue right now."); } finally { setBusy(false); }
  }
  async function confirm() {
    setBusy(true);
    try {
      const lines: string[] = [];
      for (const x of prev ?? []) { if (!x.p.ok) { lines.push(`${x.name}: ${x.p.message}`); continue; } const r = await api.post<{ message: string }>("dial/cq-send", { locationId: x.loc, list, keys: keysFor(x.loc), confirm: true }); lines.push(`${x.name}: ${r.message}`); }
      setMsg(lines.join(" ")); setPrev(null); onPickedDone?.(); void st.reload();
    } catch { setMsg("Could not add to the call queue. Nothing more was sent."); } finally { setBusy(false); }
  }
  const total = prev?.reduce((n, x) => n + (x.p.plan ? x.p.names.length : 0), 0) ?? 0;
  const lines = (st.data?.status ?? []).filter((s) => s.autoOn);

  return (
    <div className="mt-4 border-t pt-4" data-testid="cq-card">
      {primary && <div className="flex flex-wrap items-center gap-3" data-testid="cq-primary-row">{primary(() => void review(), busy)}</div>}
      <div className={`flex flex-wrap items-center gap-2 ${primary ? "mt-3" : ""}`} role="group" aria-label="Your CRM call queue" data-testid="cq-group">
        {showSend && <button type="button" className="s6-btn" data-testid="cq-send" disabled={busy || locs.length === 0} onClick={() => void review()}>{picked && picked.length ? "Send selected to CRM call queue" : "Send to your CRM call queue"}</button>}
        {link && <a className="s6-btn" data-testid="cq-open" href={link} target="_blank" rel="noopener noreferrer">Open your call queue</a>}
        <button type="button" className="s6-btn" data-testid="cq-setup-open" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? "Hide call queue setup" : "Call queue setup"}</button>
      </div>
      <p className="s6-label mt-1">{QUEUE_HONESTY}</p>
      {lines.map((s) => <p key={s.locationId} className="s6-label mt-1" data-testid="cq-status">{nameOf(s.locationId)}: {s.line}</p>)}
      {msg && <p className="mt-2 text-sm" role="status" data-testid="cq-msg">{msg}</p>}
      {prev && (
        <div className="mt-3 rounded-lg border p-3 text-sm" role="dialog" aria-label="Add to your call queue" data-testid="cq-preview">
          {prev.map((x) => (
            <div key={x.loc} className="mb-2"><p className="font-medium" data-testid="cq-would">{x.name}: {x.p.message}</p>
              {x.p.plan && <p className="s6-label">Skipped: {x.p.plan.skipped.dnd} asked not to be contacted, {x.p.plan.skipped.noPhone} with no phone, {x.p.plan.skipped.outsideHours} outside calling hours, {x.p.plan.skipped.recent} added in the last 24 hours.</p>}
              {x.p.names.length > 0 && <p className="s6-label">{x.p.names.slice(0, 8).map((n) => n.name).join(", ")}{x.p.names.length > 8 ? `, and ${x.p.names.length - 8} more` : ""}</p>}
              {x.p.plan && x.p.names.length === 0 && x.p.plan.skipped.outsideHours > 0 && <p className="s6-label" data-testid="cq-hours-note">Their calling hours have not opened yet, so none were added. Turn on Auto call queue in Call queue setup and they are added when hours open.</p>}
              {!x.p.live && x.p.ok && <p className="s6-label">Writing to your CRM is off for this account, so nothing will be sent.</p>}</div>
          ))}
          <p className="s6-label">Adding to the queue cannot be undone from SubSync. Take a lead off in your CRM if needed.</p>
          <div className="mt-2 flex gap-2"><button type="button" className="s6-btn" data-kind="primary" disabled={busy || total === 0} onClick={() => void confirm()} data-testid="cq-confirm">Confirm and add {total}</button><button type="button" className="s6-btn" onClick={() => setPrev(null)}>Cancel</button></div>
        </div>
      )}
      {open && <Setup accounts={locs.length ? locs.map((id) => ({ id, name: nameOf(id) })) : accounts} canEdit={st.data?.canEdit === true} onChange={() => void st.reload()} />}
    </div>
  );
}

function Setup({ accounts, canEdit, onChange }: { accounts: Account[]; canEdit: boolean; onChange: () => void }) {
  const api = useApiClient();
  const [loc, setLoc] = useState(accounts[0]?.id ?? "");
  const cur = useData<{ ready: boolean; settings: Settings }>(loc ? `dial/cq-setup?locationId=${encodeURIComponent(loc)}` : null);
  const [note, setNote] = useState<string | null>(null);
  const [pv, setPv] = useState<string | null>(null);
  const s = cur.data?.settings;
  const save = async (patch: Partial<Settings>) => { setNote(null); try { await api.put("dial/cq-setup", { locationId: loc, ...patch }); await cur.reload(); onChange(); } catch { setNote("Could not save. Saving needs the latest database update."); } };
  const check = async () => { try { const r = await api.post<{ message: string }>("dial/cq-check", { locationId: loc, route: s?.route, workflowId: s?.workflowId }); setNote(r.message); } catch { setNote("Could not check right now."); } };
  const would = async () => { try { const r = await api.post<Prev>("dial/cq-preview", { locationId: loc, auto: true }); setPv(r.message); } catch { setPv("Could not preview right now."); } };
  return (
    <div className="mt-3 rounded-lg border p-3 text-sm" data-testid="cq-setup">
      <WorkflowSetupCard loc={loc} canEdit={canEdit} tag={s?.tag ?? "call-now"} />
      {accounts.length > 1 && <select aria-label="Account" className="mb-2 min-h-9 rounded-md border bg-card px-2" value={loc} onChange={(e) => setLoc(e.target.value)}>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>}
      {!s ? <p className="s6-label">Loading...</p> : (
        <div className="flex flex-col gap-2">
          <label className="flex flex-wrap items-center gap-2"><span className="s6-label">How</span>
            <select aria-label="Route" disabled={!canEdit} className="min-h-9 rounded-md border bg-card px-2" value={s.route} onChange={(e) => void save({ route: e.target.value as "tag" | "workflow" })}><option value="tag">Add a tag (recommended)</option><option value="workflow">Enrol in a workflow</option></select></label>
          {s.route === "tag" ? <label className="flex flex-wrap items-center gap-2"><span className="s6-label">Tag</span><input aria-label="Tag" disabled={!canEdit} className="min-h-9 rounded-md border bg-card px-2" defaultValue={s.tag} onBlur={(e) => { if (e.target.value !== s.tag) void save({ tag: e.target.value }); }} /></label>
            : <label className="flex flex-wrap items-center gap-2"><span className="s6-label">Workflow id</span><input aria-label="Workflow id" disabled={!canEdit} className="min-h-9 rounded-md border bg-card px-2" defaultValue={s.workflowId ?? ""} onBlur={(e) => { void save({ workflowId: e.target.value }); }} /></label>}
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className="s6-btn" onClick={() => void check()} data-testid="cq-check">Check setup</button>
            <button type="button" role="switch" aria-checked={s.autoOn} aria-label="Auto call queue" disabled={!canEdit} className="s6-toggle" data-testid="cq-auto" onClick={() => void save({ autoOn: !s.autoOn })} /><span>Auto call queue {s.autoOn ? "on" : "off"}</span>
            {s.autoOn && <><button type="button" role="switch" aria-checked={s.paused} aria-label="Pause" disabled={!canEdit} className="s6-toggle" data-testid="cq-pause" onClick={() => void save({ paused: !s.paused })} /><span>Pause</span></>}
            <button type="button" className="s6-link" onClick={() => void would()} data-testid="cq-auto-preview">Preview what Auto would add</button>
          </div>
          <p className="s6-label">Auto adds the hottest leads while it is calling hours for them, up to {s.maxPerRun} per run and {s.maxPerDay} a day, skips anyone who asked not to be contacted, and takes a lead off once it is called, answered, booked or no longer qualifies.</p>
          {pv && <p data-testid="cq-auto-would">{pv}</p>}
          {note && <p role="status" data-testid="cq-note">{note}</p>}
          {!canEdit && <p className="s6-label">Ask your administrator to change these settings.</p>}
        </div>
      )}
    </div>
  );
}
