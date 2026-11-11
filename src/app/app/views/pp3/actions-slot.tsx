"use client";

import { Check, Loader2, Undo2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { Pp3List, Pp3NextLead, Pp3Person, Pp3Proof } from "@/lib/analytics/people3-types";
import { ApiError, useApiClient } from "../../session";
import { BTN, DANGER, ModeLine, Notes, PRIMARY, type Blocker, type Mode } from "../appointment-actions-ui";
import { Sheet } from "../pipeline-actions-ui";
import { fixturesOn, queryOf } from "./data";

// The Team actions (slice PB), mounted into the screens through these four components. The server decides what each person may do (GET people3/act/caps) and answers every change with a
// preview first; nothing is sent to a lead and no change reaches the CRM until the person confirms. A button that the person may not use is not drawn. With ?ppfx=1 (sample data) none of this draws.
type Changed = { onChanged: () => void };
type Kind = { id: string; label: string; unit: string; min: number; max: number };
type Caps = {
  role: string; me: string | null; writeNotes: boolean; writeTargets: boolean; away: boolean; suggest: boolean; reassign: boolean; proof: boolean;
  limits: { reassign: number; export: number; undoMinutes: number; proofDays: number }; targetKinds: Kind[];
};
type Change = { label: string; from: string; to: string };
type Preview = { ok?: boolean; preview?: { summary: string; changes: Change[]; note?: string; confirm?: { needed: boolean; words: string[] } } };

const FIELD = "min-h-11 w-full rounded-md border bg-background px-3 text-sm sm:min-h-9";
const msgOf = (e: unknown) => (e instanceof ApiError && typeof e.body.message === "string" ? e.body.message : e instanceof ApiError && typeof e.body.error === "string" ? e.body.error : e instanceof Error ? e.message : "Something went wrong. Nothing was changed.");
const blockersOf = (e: unknown): Blocker[] | null => (e instanceof ApiError && Array.isArray(e.body.blockers) ? (e.body.blockers as Blocker[]) : null);
const needsPermissionOf = (e: unknown) => e instanceof ApiError && e.body.needsPermission === true;

let capsShared: { api: unknown; at: number; p: Promise<Caps | null> } | null = null;
/** What this person may do. One shared request; a failed or switched-off answer simply draws no buttons. */
function useCaps(): Caps | null {
  const api = useApiClient();
  const off = fixturesOn();
  const [caps, setCaps] = useState<Caps | null>(null);
  useEffect(() => {
    if (off) return;
    if (!capsShared || capsShared.api !== api || Date.now() - capsShared.at > 60_000) capsShared = { api, at: Date.now(), p: api.get<Caps>("people3/act/caps").catch(() => null) };
    let live = true;
    void capsShared.p.then((c) => { if (live) setCaps(c); });
    return () => { live = false; };
  }, [api, off]);
  return caps;
}

/** One change: shows the preview the server made, asks for the typed words when the change removes something, then does it. */
function Flow(p: { path: string; body: Record<string, unknown>; title: string; doLabel: string; danger?: boolean; onClose: () => void; onChanged: () => void; testId?: string }) {
  const api = useApiClient();
  const [pre, setPre] = useState<Preview | null>(null), [typed, setTyped] = useState(""), [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null), [blk, setBlk] = useState<Blocker[] | null>(null), [done, setDone] = useState<string | null>(null);
  const key = JSON.stringify(p.body);
  useEffect(() => {
    let live = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPre(null); setErr(null); setBlk(null);
    api.post<Preview>(p.path, { ...p.body, step: "preview" }).then((r) => { if (live) setPre(r); }).catch((e) => { if (live) { setBlk(blockersOf(e)); setErr(blockersOf(e) ? null : msgOf(e)); } });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, p.path, key]);
  const words = pre?.preview?.confirm?.needed ? pre.preview.confirm.words : null;
  const typedOk = !words || words.some((w) => w.toLowerCase() === typed.trim().toLowerCase().replace(/\s+/g, " "));
  const go = async () => {
    setBusy(true); setErr(null); setBlk(null);
    try { const r = await api.post<{ message?: string }>(p.path, { ...p.body, step: "do", ...(words ? { typed } : {}) }); setDone(r.message ?? "Done."); p.onChanged(); }
    catch (e) { setBlk(blockersOf(e)); setErr(blockersOf(e) ? null : msgOf(e)); }
    finally { setBusy(false); }
  };
  return (
    <Sheet title={p.title} onClose={p.onClose} testId={p.testId ?? "pp-flow"}>
      {done ? (
        <div role="status"><p className="flex items-center gap-2 text-sm"><Check aria-hidden className="size-4" />{done}</p><div className="mt-3"><button type="button" onClick={p.onClose} className={PRIMARY}>Close</button></div></div>
      ) : pre?.preview ? (
        <div data-testid="pp-preview">
          <p className="text-sm font-medium">{pre.preview.summary}</p>
          {pre.preview.changes.length > 0 && <ul className="mt-2 divide-y rounded-md border text-sm">{pre.preview.changes.map((c) => <li key={c.label} className="flex flex-wrap gap-x-3 px-3 py-1.5"><span className="w-32 shrink-0 text-muted-foreground">{c.label}</span><span>{c.from} to <b>{c.to}</b></span></li>)}</ul>}
          {pre.preview.note && <p className="mt-2 text-xs text-muted-foreground">{pre.preview.note}</p>}
          {words && <label className="mt-3 block text-sm">Type <b>{words[0]}</b>{words[1] ? <> or <b>{words[1]}</b></> : null} to confirm<input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false} className={`${FIELD} mt-1`} aria-label="Type the confirmation" /></label>}
          <Notes blockers={blk ?? undefined} />
          {err && <p role="alert" className="mt-2 text-sm text-destructive">{err}</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={() => void go()} disabled={busy || !typedOk} className={p.danger ? DANGER : PRIMARY} data-testid="pp-confirm">{busy ? <Loader2 aria-hidden className="size-4 animate-spin" /> : <Check aria-hidden className="size-4" />}{p.doLabel}</button>
            <button type="button" onClick={p.onClose} className={BTN}>Cancel</button>
          </div>
        </div>
      ) : err || blk ? (
        <div><Notes blockers={blk ?? undefined} />{err && <p role="alert" className="text-sm text-destructive">{err}</p>}<div className="mt-3"><button type="button" onClick={p.onClose} className={BTN}>Close</button></div></div>
      ) : <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 aria-hidden className="size-4 animate-spin" />Checking what would change...</p>}
    </Sheet>
  );
}

// ---------------- notes, targets, away: in the person panel and on the Coaching tab ----------------

type NoteOut = { id: string; title: string; body: string; shared: boolean; authorName: string | null; createdAt: number };
function NotesSheet({ person, locationId, onClose, onChanged }: { person: Pp3Person; locationId: string | null; onClose: () => void; onChanged: () => void }) {
  const api = useApiClient();
  const [notes, setNotes] = useState<NoteOut[] | null>(null), [nonce, setNonce] = useState(0), [err, setErr] = useState<string | null>(null);
  const [edit, setEdit] = useState<{ id: string | null; title: string; body: string; shared: boolean } | null>(null), [flow, setFlow] = useState<Record<string, unknown> | null>(null), [flowTitle, setFlowTitle] = useState("");
  useEffect(() => {
    let live = true;
    api.get<{ notes: NoteOut[] }>(`people3/act/notes?userId=${encodeURIComponent(person.userId)}`).then((r) => { if (live) setNotes(r.notes); }).catch((e) => { if (live) setErr(msgOf(e)); });
    return () => { live = false; };
  }, [api, person.userId, nonce]);
  const changed = () => { setNonce((n) => n + 1); onChanged(); };
  return (
    <Sheet title={`Coaching notes about ${person.name}`} onClose={onClose} testId="pp-notes-sheet">
      <p className="mb-2 text-xs text-muted-foreground">Private to you and your administrators unless you share a note with {person.name}. Notes are kept only in SubSync, never in your CRM.</p>
      {err && <p role="alert" className="text-sm text-destructive">{err}</p>}
      {!err && notes === null && <p className="text-sm text-muted-foreground">Loading...</p>}
      {notes && notes.length === 0 && !edit && <p className="text-sm">No notes yet. Write one thing you agreed with {person.name}, so you both remember it.</p>}
      {notes && !edit && <ul className="grid gap-2">{notes.map((n) => (
        <li key={n.id} className="rounded-md border p-2 text-sm"><b>{n.title}</b>{n.shared ? <span className="text-xs text-muted-foreground"> (shared with them)</span> : null}<p className="whitespace-pre-wrap">{n.body}</p>
          <div className="mt-1 flex gap-3"><button type="button" className="text-xs underline" onClick={() => setEdit({ id: n.id, title: n.title, body: n.body, shared: n.shared })}>Edit</button>
            <button type="button" className="text-xs underline text-destructive" onClick={() => { setFlowTitle("Remove this note"); setFlow({ op: "remove", id: n.id }); }}>Remove</button></div></li>))}</ul>}
      {edit ? (
        <form className="grid gap-2" onSubmit={(e) => { e.preventDefault(); setFlowTitle(edit.id ? "Save the note" : "Add the note"); setFlow(edit.id ? { op: "edit", id: edit.id, title: edit.title, body: edit.body, shared: edit.shared } : { op: "add", userId: person.userId, locationId, title: edit.title, body: edit.body, shared: edit.shared }); }}>
          <label className="text-sm">Title<input value={edit.title} maxLength={60} onChange={(e) => setEdit({ ...edit, title: e.target.value })} className={`${FIELD} mt-1`} required /></label>
          <label className="text-sm">Note<textarea value={edit.body} maxLength={2000} rows={4} onChange={(e) => setEdit({ ...edit, body: e.target.value })} className={`${FIELD} mt-1 py-2`} required /></label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={edit.shared} onChange={(e) => setEdit({ ...edit, shared: e.target.checked })} />Let {person.name} read this note</label>
          <div className="flex gap-2"><button type="submit" className={PRIMARY}>Review</button><button type="button" className={BTN} onClick={() => setEdit(null)}>Back</button></div>
        </form>
      ) : <div className="mt-3"><button type="button" className={PRIMARY} onClick={() => setEdit({ id: null, title: "", body: "", shared: false })} data-testid="pp-note-add">Add a note</button></div>}
      {flow && <Flow path="people3/act/note" body={flow} title={flowTitle} doLabel={flow.op === "remove" ? "Remove the note" : "Save"} danger={flow.op === "remove"} onClose={() => setFlow(null)} onChanged={() => { setEdit(null); changed(); }} />}
    </Sheet>
  );
}

type TargetRow = { locationId: string | null; metric: string; target: number; label: string; unit: string };
function TargetsSheet({ person, caps, onClose, onChanged }: { person: Pp3Person; caps: Caps; onClose: () => void; onChanged: () => void }) {
  const api = useApiClient();
  const [rows, setRows] = useState<TargetRow[] | null>(null), [accounts, setAccounts] = useState<Array<{ locationId: string; name: string }>>([]), [nonce, setNonce] = useState(0);
  const [metric, setMetric] = useState(caps.targetKinds[0]?.id ?? "reply_minutes"), [value, setValue] = useState(""), [loc, setLoc] = useState(""), [flow, setFlow] = useState<Record<string, unknown> | null>(null);
  useEffect(() => {
    let live = true;
    api.get<{ targets: TargetRow[]; accounts: Array<{ locationId: string; name: string }> }>(`people3/act/targets?userId=${encodeURIComponent(person.userId)}`).then((r) => { if (live) { setRows(r.targets); setAccounts(r.accounts); } }).catch(() => { if (live) setRows([]); });
    return () => { live = false; };
  }, [api, person.userId, nonce]);
  const kind = caps.targetKinds.find((k) => k.id === metric);
  const changed = () => { setNonce((n) => n + 1); onChanged(); };
  return (
    <Sheet title={`Targets for ${person.name}`} onClose={onClose} testId="pp-targets-sheet">
      <p className="mb-2 text-xs text-muted-foreground">Until you set one here, each client account&apos;s own reply target is used. A target is a goal for coaching, never a rule that changes anything.</p>
      {rows && rows.length > 0 && <ul className="mb-3 grid gap-1 text-sm">{rows.map((t) => <li key={`${t.metric}:${t.locationId}`} className="flex flex-wrap items-center gap-2"><span>{t.label}: <b>{t.target} {t.unit}</b>{t.locationId ? ` (${accounts.find((a) => a.locationId === t.locationId)?.name ?? "one account"})` : ""}</span>
        <button type="button" className="text-xs underline text-destructive" onClick={() => setFlow({ userId: person.userId, locationId: t.locationId, metric: t.metric, value: null })}>Clear</button></li>)}</ul>}
      <form className="grid gap-2" onSubmit={(e) => { e.preventDefault(); setFlow({ userId: person.userId, locationId: loc || null, metric, value: Number(value) }); }}>
        <label className="text-sm">Goal<select value={metric} onChange={(e) => setMetric(e.target.value)} className={`${FIELD} mt-1`}>{caps.targetKinds.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}</select></label>
        <label className="text-sm">Number{kind ? ` (${kind.unit})` : ""}<input type="number" inputMode="decimal" min={kind?.min} max={kind?.max} step="any" value={value} onChange={(e) => setValue(e.target.value)} className={`${FIELD} mt-1`} required /></label>
        {accounts.length > 1 && <label className="text-sm">Applies to<select value={loc} onChange={(e) => setLoc(e.target.value)} className={`${FIELD} mt-1`}><option value="">Every account they work in</option>{accounts.map((a) => <option key={a.locationId} value={a.locationId}>{a.name}</option>)}</select></label>}
        <div><button type="submit" className={PRIMARY} data-testid="pp-target-review">Review</button></div>
      </form>
      {flow && <Flow path="people3/act/target" body={flow} title={flow.value === null ? "Clear this target" : "Set this target"} doLabel={flow.value === null ? "Clear the target" : "Save the target"} danger={flow.value === null} onClose={() => setFlow(null)} onChanged={() => { setValue(""); changed(); }} />}
    </Sheet>
  );
}

type Mark = { id: string; userId: string; kind: "away" | "idle_snooze"; reasonText: string | null; until: number };
function AwaySheet({ person, onClose, onChanged }: { person: Pp3Person; onClose: () => void; onChanged: () => void }) {
  const api = useApiClient();
  const [marks, setMarks] = useState<Mark[] | null>(null), [nonce, setNonce] = useState(0), [flow, setFlow] = useState<Record<string, unknown> | null>(null), [err, setErr] = useState<string | null>(null);
  const [reason, setReason] = useState("holiday"), [until, setUntil] = useState(""), [hours, setHours] = useState("24");
  useEffect(() => {
    let live = true;
    api.get<{ marks: Mark[] }>("people3/act/away").then((r) => { if (live) setMarks(r.marks.filter((m) => m.userId === person.userId)); }).catch(() => { if (live) setMarks([]); });
    return () => { live = false; };
  }, [api, person.userId, nonce]);
  const changed = () => { setNonce((n) => n + 1); onChanged(); };
  const end = async (id: string) => { try { await api.post("people3/act/away-end", { id }); changed(); } catch (e) { setErr(msgOf(e)); } };
  const [tomorrow] = useState(() => new Date(Date.now() + 86_400_000).toISOString().slice(0, 10));
  return (
    <Sheet title={`${person.name}: away and quiet reminders`} onClose={onClose} testId="pp-away-sheet">
      <p className="mb-2 text-xs text-muted-foreground">Away people are left out of the &quot;gone quiet&quot; reminders and of the next-lead suggestion. This stays in SubSync only.</p>
      {marks && marks.length > 0 && <ul className="mb-3 grid gap-1 text-sm">{marks.map((m) => <li key={m.id} className="flex flex-wrap items-center gap-2"><span>{m.kind === "away" ? (m.reasonText ?? "Away") : "Quiet reminders snoozed"} until {new Date(m.until).toISOString().slice(0, 10)}</span><button type="button" className="text-xs underline" onClick={() => void end(m.id)}>End now</button></li>)}</ul>}
      {err && <p role="alert" className="text-sm text-destructive">{err}</p>}
      <form className="mb-4 grid gap-2" onSubmit={(e) => { e.preventDefault(); setFlow({ kind: "away", userId: person.userId, reason, until: `${until}T23:59:59Z` }); }}>
        <b className="text-sm">Mark {person.name} away</b>
        <select value={reason} onChange={(e) => setReason(e.target.value)} className={FIELD} aria-label="Why"><option value="holiday">On holiday</option><option value="sick">Off sick</option><option value="training">In training</option><option value="other">Away</option></select>
        <label className="text-sm">Back on<input type="date" min={tomorrow} value={until} onChange={(e) => setUntil(e.target.value)} className={`${FIELD} mt-1`} required /></label>
        <div><button type="submit" className={PRIMARY}>Review</button></div>
      </form>
      <form className="grid gap-2" onSubmit={(e) => { e.preventDefault(); setFlow({ kind: "idle_snooze", userId: person.userId, hours: Number(hours) }); }}>
        <b className="text-sm">Snooze the &quot;gone quiet&quot; reminder</b>
        <select value={hours} onChange={(e) => setHours(e.target.value)} className={FIELD} aria-label="For how long"><option value="4">4 hours</option><option value="24">1 day</option><option value="72">3 days</option><option value="168">7 days</option></select>
        <div><button type="submit" className={BTN}>Review</button></div>
      </form>
      {flow && <Flow path="people3/act/away" body={flow} title={flow.kind === "away" ? "Mark as away" : "Snooze the reminder"} doLabel="Confirm" onClose={() => setFlow(null)} onChanged={changed} />}
    </Sheet>
  );
}

/** In the person panel and on the Coaching tab: add a note, set a target, mark away, snooze the idle alert. */
export function PersonActionsSlot({ person, locationId, onChanged }: { person: Pp3Person; locationId: string | null } & Changed) {
  const caps = useCaps();
  const [open, setOpen] = useState<"notes" | "targets" | "away" | null>(null);
  if (!caps || person.deleted) return null;
  if (!(caps.writeNotes || caps.writeTargets || caps.away)) return null;
  return (
    <div className="pp-actions print:hidden" data-testid="pp-person-actions">
      <div className="flex flex-wrap gap-2">
        {caps.writeNotes && <button type="button" className={BTN} onClick={() => setOpen("notes")} data-testid="pp-open-notes">Coaching notes</button>}
        {caps.writeTargets && <button type="button" className={BTN} onClick={() => setOpen("targets")} data-testid="pp-open-targets">Set a target</button>}
        {caps.away && <button type="button" className={BTN} onClick={() => setOpen("away")} data-testid="pp-open-away">Away or snooze</button>}
      </div>
      {open === "notes" && <NotesSheet person={person} locationId={locationId} onClose={() => setOpen(null)} onChanged={onChanged} />}
      {open === "targets" && <TargetsSheet person={person} caps={caps} onClose={() => setOpen(null)} onChanged={onChanged} />}
      {open === "away" && <AwaySheet person={person} onClose={() => setOpen(null)} onChanged={onChanged} />}
    </div>
  );
}

// ---------------- moving leads to another owner (preview, tick, 30 minute undo) ----------------

type ReassignPreview = {
  mode: Mode; needsPermission: boolean; owner: string | null;
  plan: { change: Array<{ contactId: string; name: string; from: string; url: string }>; same: number; unknown: number; protected: Array<{ contactId: string; name: string; reasons: string[] }>; overCap: number; cap: number; blockers: Blocker[]; warnings: Blocker[]; needsTick: string[]; summary: string; note?: string; reversible: boolean; undoMinutes: number };
};
type ReassignDone = { ok?: boolean; batchId?: string; done?: number; dryRun?: number; message?: string; undoable?: boolean; undoMinutes?: number };

function ReassignFlow(p: { locationId: string; toUserId: string; toName: string; contactIds: string[]; suggested: boolean; onClose: () => void; onChanged: () => void }) {
  const api = useApiClient();
  const [pre, setPre] = useState<ReassignPreview | null>(null), [ticks, setTicks] = useState<string[]>([]), [busy, setBusy] = useState(false), [err, setErr] = useState<string | null>(null), [blk, setBlk] = useState<Blocker[] | null>(null);
  const [res, setRes] = useState<ReassignDone | null>(null), [undone, setUndone] = useState<string | null>(null);
  const body = { locationId: p.locationId, contactIds: p.contactIds, toUserId: p.toUserId, suggested: p.suggested };
  useEffect(() => {
    let live = true;
    api.post<ReassignPreview>("people3/act/reassign", { ...body, step: "preview" }).then((r) => { if (live) setPre(r); }).catch((e) => { if (live) { setBlk(blockersOf(e)); setErr(blockersOf(e) ? null : msgOf(e)); } });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, p.locationId, p.toUserId, p.contactIds.join(",")]);
  const plan = pre?.plan;
  const ticked = !plan || plan.needsTick.every((t) => ticks.includes(t));
  const go = async () => {
    setBusy(true); setErr(null); setBlk(null);
    try { setRes(await api.post<ReassignDone>("people3/act/reassign", { ...body, step: "do", acks: ticks })); p.onChanged(); }
    catch (e) { setBlk(blockersOf(e)); setErr(needsPermissionOf(e) ? "Needs permission: reconnect SubSync so it may change who owns a lead. Nothing was changed." : blockersOf(e) ? null : msgOf(e)); }
    finally { setBusy(false); }
  };
  const undo = async () => {
    try { const r = await api.post<{ message?: string }>("people3/act/undo", { locationId: p.locationId, batchId: res?.batchId, step: "do" }); setUndone(r.message ?? "Put back."); p.onChanged(); }
    catch (e) { setUndone(msgOf(e)); }
  };
  return (
    <Sheet title={`Move leads to ${p.toName}`} onClose={p.onClose} testId="pp-reassign-flow">
      {res ? (
        <div role="status" data-testid="pp-reassign-result"><p className="flex items-center gap-2 text-sm"><Check aria-hidden className="size-4" />{res.message ?? "Done."}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {res.undoable && res.batchId && !undone && <button type="button" onClick={() => void undo()} className={BTN} data-testid="pp-undo"><Undo2 aria-hidden className="size-4" />Undo (open for {res.undoMinutes ?? 30} min)</button>}
            {undone && <span className="text-sm text-muted-foreground">{undone}</span>}
            <button type="button" onClick={p.onClose} className={PRIMARY}>Close</button></div></div>
      ) : plan && pre ? (
        <div data-testid="pp-reassign-preview">
          <p className="text-sm font-medium">{plan.summary}</p>
          {plan.change.length > 0 && <ul className="mt-2 max-h-48 divide-y overflow-y-auto rounded-md border text-sm">{plan.change.slice(0, 12).map((c) => <li key={c.contactId} className="px-3 py-1.5">{c.name} <span className="text-muted-foreground">from {c.from}</span></li>)}{plan.change.length > 12 && <li className="px-3 py-1.5 text-muted-foreground">and {plan.change.length - 12} more</li>}</ul>}
          {plan.protected.length > 0 && <p className="mt-2 text-xs text-muted-foreground">Left alone ({plan.protected.length}): {plan.protected.slice(0, 4).map((x) => `${x.name} (${x.reasons[0] ?? "protected"})`).join("; ")}{plan.protected.length > 4 ? "..." : ""}</p>}
          {plan.same > 0 && <p className="mt-1 text-xs text-muted-foreground">{plan.same} already belong{plan.same === 1 ? "s" : ""} to {p.toName}.</p>}
          {plan.overCap > 0 && <p className="mt-1 text-xs text-muted-foreground">{plan.overCap} more are over the limit of {plan.cap} at a time. Run it again for those.</p>}
          {plan.note && <p className="mt-1 text-xs text-muted-foreground">{plan.note}</p>}
          <Notes blockers={[...plan.blockers, ...(blk ?? [])]} warnings={plan.warnings} />
          {plan.needsTick.map((t) => <label key={t} className="mt-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={ticks.includes(t)} onChange={(e) => setTicks(e.target.checked ? [...ticks, t] : ticks.filter((x) => x !== t))} />I checked this before moving it</label>)}
          <ModeLine mode={pre.mode} needsPermission={pre.needsPermission} />
          {pre.needsPermission && <p className="mt-2 text-sm text-destructive" role="alert">Needs permission: reconnect SubSync so it may change who owns a lead.</p>}
          {err && <p role="alert" className="mt-2 text-sm text-destructive">{err}</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={() => void go()} disabled={busy || plan.blockers.length > 0 || plan.change.length === 0 || !ticked || (pre.mode.live && pre.needsPermission)} className={PRIMARY} data-testid="pp-reassign-confirm">{busy ? <Loader2 aria-hidden className="size-4 animate-spin" /> : <Check aria-hidden className="size-4" />}{pre.mode.live ? "Move them" : "Run practice"}</button>
            <button type="button" onClick={p.onClose} className={BTN}>Cancel</button>
          </div>
        </div>
      ) : err || blk ? <div><Notes blockers={blk ?? undefined} />{err && <p role="alert" className="text-sm text-destructive">{err}</p>}<div className="mt-3"><button type="button" onClick={p.onClose} className={BTN}>Close</button></div></div>
        : <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 aria-hidden className="size-4 animate-spin" />Checking which leads can move...</p>}
    </Sheet>
  );
}

type Rebalance = { hidden: string | null; hiddenText: string | null; groups: Array<{ userId: string; name: string; contactIds: string[]; waitingAfter: number }>; from: { name: string; waiting: number; waitingAfter: number }; moved: number; protectedLeft: number; label: string; how: string };
/** In Workload, beside a heavy or waiting row: "Move leads" shows an estimate of who could take some, then opens the preview. */
export function MoveLeadsSlot({ userId, locationId, waiting, onChanged }: { userId: string; locationId: string; waiting: number } & Changed) {
  const caps = useCaps(), api = useApiClient();
  const [open, setOpen] = useState(false), [r, setR] = useState<Rebalance | null>(null), [err, setErr] = useState<string | null>(null), [group, setGroup] = useState<Rebalance["groups"][number] | null>(null);
  useEffect(() => {
    if (!open) return;
    let live = true;
    api.get<Rebalance>(`people3/act/rebalance?locationId=${encodeURIComponent(locationId)}&userId=${encodeURIComponent(userId)}`).then((x) => { if (live) setR(x); }).catch((e) => { if (live) setErr(msgOf(e)); });
    return () => { live = false; };
  }, [api, open, locationId, userId]);
  if (!caps?.reassign || waiting < 2) return null;
  return (
    <>
      <button type="button" className="ap-link print:hidden" onClick={() => { setR(null); setErr(null); setOpen(true); }} data-testid="pp-move-leads">Move leads</button>
      {open && (
        <Sheet title="Spread the waiting leads" onClose={() => setOpen(false)} testId="pp-rebalance-sheet">
          {err && <p role="alert" className="text-sm text-destructive">{err}</p>}
          {!r && !err && <p className="text-sm text-muted-foreground">Looking at who has room...</p>}
          {r && r.groups.length === 0 && <p className="text-sm">{r.hiddenText ?? (r.hidden === "balanced" ? "The team is already evenly loaded." : "Nothing can be moved right now.")}</p>}
          {r && r.groups.length > 0 && (
            <div>
              <p className="text-sm"><b>{r.from.name}</b> has {r.from.waiting} leads waiting. {r.label}</p>
              <ul className="mt-2 grid gap-2">{r.groups.map((g) => <li key={g.userId} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2 text-sm"><span>Give <b>{g.contactIds.length}</b> to <b>{g.name}</b> <span className="text-muted-foreground">(they would have {g.waitingAfter} waiting)</span></span><button type="button" className={BTN} onClick={() => setGroup(g)}>Review</button></li>)}</ul>
              {r.protectedLeft > 0 && <p className="mt-2 text-xs text-muted-foreground">{r.protectedLeft} lead{r.protectedLeft === 1 ? " stays" : "s stay"} where {r.protectedLeft === 1 ? "it is" : "they are"} (asked not to be contacted, an open deal, a customer, or an appointment coming up).</p>}
              <p className="mt-2 text-xs text-muted-foreground">{r.how}</p>
            </div>
          )}
        </Sheet>
      )}
      {group && <ReassignFlow locationId={locationId} toUserId={group.userId} toName={group.name} contactIds={group.contactIds} suggested onClose={() => setGroup(null)} onChanged={() => { setR(null); onChanged(); }} />}
    </>
  );
}

/** Under the next-lead suggestion: "Assign" lets the person tick waiting leads that have no owner, then opens the same preview. Never automatic. */
export function AssignSlot({ suggestion, onChanged }: { suggestion: Pp3NextLead } & Changed) {
  const caps = useCaps(), api = useApiClient();
  const [open, setOpen] = useState(false), [rows, setRows] = useState<Pp3List["rows"] | null>(null), [pick, setPick] = useState<string[]>([]), [review, setReview] = useState(false), [err, setErr] = useState<string | null>(null);
  const who = suggestion.suggestion, loc = suggestion.location?.locationId ?? null;
  useEffect(() => {
    if (!open || !loc) return;
    let live = true;
    api.get<Pp3List>(queryOf("list", { reason: "no_owner", location: loc, size: 25 })).then((x) => { if (live) setRows(x.rows.filter((r) => r.contactId)); }).catch((e) => { if (live) setErr(msgOf(e)); });
    return () => { live = false; };
  }, [api, open, loc]);
  if (!caps?.reassign || !who || !loc) return null;
  return (
    <>
      <button type="button" className={BTN} onClick={() => { setRows(null); setPick([]); setErr(null); setOpen(true); }} data-testid="pp-assign">Assign leads to {who.name}</button>
      {open && !review && (
        <Sheet title={`Assign leads to ${who.name}`} onClose={() => setOpen(false)} testId="pp-assign-sheet">
          <p className="mb-2 text-xs text-muted-foreground">These leads are waiting for a reply and have no owner. Tick the ones to give to {who.name}. You will see a preview before anything changes.</p>
          {err && <p role="alert" className="text-sm text-destructive">{err}</p>}
          {!rows && !err && <p className="text-sm text-muted-foreground">Loading...</p>}
          {rows && rows.length === 0 && <p className="text-sm">No waiting lead is without an owner. To move leads someone already has, use Move leads in the Workload table.</p>}
          {rows && rows.length > 0 && <ul className="max-h-64 divide-y overflow-y-auto rounded-md border text-sm">{rows.map((r) => <li key={r.id} className="px-3 py-1.5"><label className="flex items-center gap-2"><input type="checkbox" checked={pick.includes(r.contactId as string)} onChange={(e) => setPick(e.target.checked ? [...pick, r.contactId as string] : pick.filter((x) => x !== r.contactId))} />{r.title}{r.ageHours !== null ? <span className="text-muted-foreground"> waiting {r.ageHours < 48 ? `${r.ageHours} h` : `${Math.round(r.ageHours / 24)} days`}</span> : null}</label></li>)}</ul>}
          <div className="mt-3"><button type="button" className={PRIMARY} disabled={pick.length === 0} onClick={() => setReview(true)}>Review {pick.length || ""}</button></div>
        </Sheet>
      )}
      {open && review && <ReassignFlow locationId={loc} toUserId={who.userId} toName={who.name} contactIds={pick} suggested onClose={() => { setReview(false); setOpen(false); }} onChanged={onChanged} />}
    </>
  );
}

// ---------------- the client receipt: copy, print, CSV, and whether it names staff ----------------

/** On the Proof tab: copy, print and CSV of the receipt, and the choice to name staff for this client (preview first). */
export function ProofActionsSlot({ proof }: { proof: Pp3Proof }) {
  const caps = useCaps(), api = useApiClient();
  const loc = proof.location?.locationId ?? null, days = Math.min(90, Math.max(1, proof.period.days));
  const [msg, setMsg] = useState<string | null>(null), [names, setNames] = useState<boolean | null>(null), [flow, setFlow] = useState(false), [nonce, setNonce] = useState(0);
  useEffect(() => {
    if (!loc || !caps?.proof) return;
    let live = true;
    api.get<{ nameStaff: boolean }>(`people3/act/proof-prefs?locationId=${encodeURIComponent(loc)}`).then((r) => { if (live) setNames(r.nameStaff); }).catch(() => { if (live) setNames(null); });
    return () => { live = false; };
  }, [api, loc, caps?.proof, nonce]);
  if (!caps?.proof || !loc) return null;
  const copy = async () => {
    try { const r = await api.get<{ text: string }>(`people3/act/proof?locationId=${encodeURIComponent(loc)}&days=${days}`); await navigator.clipboard.writeText(r.text); setMsg("Copied. Paste it into an email or a message to your client."); }
    catch (e) { setMsg(msgOf(e)); }
  };
  const csv = async () => { try { await api.download(`people3/act/proof-csv?locationId=${encodeURIComponent(loc)}&days=${days}`, "team-receipt.csv"); setMsg(null); } catch (e) { setMsg(msgOf(e)); } };
  return (
    <div className="pp-actions print:hidden" data-testid="pp-proof-actions">
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" className={PRIMARY} onClick={() => void copy()} data-testid="pp-proof-copy">Copy for your client</button>
        <button type="button" className={BTN} onClick={() => window.print()} data-testid="pp-proof-print">Print</button>
        <button type="button" className={BTN} onClick={() => void csv()} data-testid="pp-proof-csv">Download CSV</button>
        {names !== null && <button type="button" className={BTN} onClick={() => setFlow(true)} data-testid="pp-proof-names">{names ? "Show the team as a whole" : "Show staff names"}</button>}
      </div>
      {msg && <p className="ap-fine mt-1" role="status">{msg}</p>}
      <p className="ap-fine mt-1">The receipt shows the team as a whole unless you choose to name staff for this client. It never includes a message.</p>
      {flow && names !== null && <Flow path="people3/act/proof-prefs" body={{ locationId: loc, nameStaff: !names }} title="Names on this client's receipts" doLabel="Confirm" onClose={() => setFlow(false)} onChanged={() => setNonce((n) => n + 1)} />}
    </div>
  );
}
