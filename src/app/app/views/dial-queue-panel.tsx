"use client";

import { ExternalLink, ListPlus, SlidersHorizontal } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useApiClient, useData } from "../session";
import { WorkflowSetupCard } from "./workflow-setup-card";
import { usePowerDialer } from "./power-dialer";

// "Send to your CRM call queue" and the Auto call queue card (docs/features/DIALQUEUE.md). SubSync cannot start a call itself; the call queue is your CRM's own dialer. SubSync adds a tag
// (or enrols the lead in a workflow) that you set up once in your CRM, and your CRM's Manual Actions page fills itself. Everything is previewed first, and adding cannot be undone from SubSync.

type Account = { id: string; name: string };
type St = { ready: boolean; accounts: Account[]; canEdit: boolean; queueLinks: Record<string, string>; status: Array<{ locationId: string; line: string; inQueue: number; autoOn: boolean; paused: boolean }> };
type Settings = { route: "tag" | "workflow"; tag: string; workflowId: string | null; autoOn: boolean; paused: boolean; maxPerRun: number; maxPerDay: number; windowStart: number; windowEnd: number };
type Prev = { ok: boolean; message: string; live: boolean; names: Array<{ key: string; name: string; phone: string | null; list: string }>; plan: { skipped: { dnd: number; noPhone: number; outsideHours: number; recent: number; cap: number } } | null };
type Item = { locationId: string; contactId: string };

export const QUEUE_HONESTY = "SubSync cannot start a call itself. The call queue is your CRM's own dialer.";

/** `primary` is the always-live main button of the screen (it can start the review below); `showSend` keeps the plain "Send to your CRM call queue" button when the main button is something else. */
export function CallQueueCard({ list, items, onPickedDone, picked, primary, tools, showSend = true }: { list: string; items: Item[]; picked?: string[]; onPickedDone?: () => void; primary?: (review: () => void, busy: boolean) => ReactNode; tools?: ReactNode; showSend?: boolean }) {
  const st = useData<St>("dial/cq-status");
  const [open, setOpen] = useState(false);
  const accounts = st.data?.accounts ?? [];
  const nameOf = (id: string) => accounts.find((a) => a.id === id)?.name ?? "Account";
  const locs = [...new Set(items.map((i) => i.locationId))];
  const keysFor = (loc: string) => (picked && picked.length ? picked.filter((k) => k.startsWith(`${loc}:`)) : items.filter((i) => i.locationId === loc).slice(0, 50).map((i) => `${i.locationId}:${i.contactId}`));
  const link = st.data?.queueLinks?.[locs[0] ?? ""];

  const pd = usePowerDialer({ list, locs, nameOf, keysFor, onSent: () => { onPickedDone?.(); void st.reload(); } });
  const review = () => void pd.start();
  const busy = pd.busy;
  const lines = (st.data?.status ?? []).filter((s) => s.autoOn);

  return (
    <div data-testid="cq-card">
      {primary && <div className="cm-sec"><div className="cm-primary-row" data-testid="cq-primary-row">{primary(() => void review(), busy)}</div></div>}
      <div className="cm-toolbar" role="group" aria-label="Your CRM call queue" data-testid="cq-group">
        {tools}
        {tools && <span className="cm-tool-sep" aria-hidden />}
        {showSend && <button type="button" className="cm-tool" data-tip="Adds these people to the call queue in your CRM and opens its power dialer. You see a preview first." data-testid="cq-send" disabled={busy || locs.length === 0} onClick={review}><ListPlus aria-hidden />{picked && picked.length ? "Send selected to power dialer" : "Send to power dialer"}</button>}
        {link && <a className="cm-tool" data-tip="Opens your CRM's call queue in a new tab." data-testid="cq-open" href={link} target="_blank" rel="noopener noreferrer"><ExternalLink aria-hidden />Open your call queue</a>}
        <button type="button" className="cm-tool cm-tool-end" data-tip="Choose the tag or workflow your CRM uses, and turn on the auto queue." data-testid="cq-setup-open" aria-expanded={open} onClick={() => setOpen(!open)}><SlidersHorizontal aria-hidden />{open ? "Hide call queue setup" : "Call queue setup"}</button>
      </div>
      <div className="cm-sec" hidden={!(lines.length > 0 || open)} data-testid="cq-more">
      {lines.map((s) => <p key={s.locationId} className="s6-label" data-testid="cq-status">{nameOf(s.locationId)}: {s.line}</p>)}
      {open && <Setup accounts={locs.length ? locs.map((id) => ({ id, name: nameOf(id) })) : accounts} canEdit={st.data?.canEdit === true} onChange={() => void st.reload()} />}
      </div>
      {pd.panel}
      <p className="s6-label cm-sec !py-3">{QUEUE_HONESTY}</p>
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
    <div className="cm-panel" data-testid="cq-setup">
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
