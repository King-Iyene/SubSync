"use client";

import { Check, ChevronDown, Loader2, Undo2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { fixturesOn } from "./views/pp3/data";
import { BTN, DANGER, PRIMARY } from "./views/appointment-actions-ui";
import { Sheet } from "./views/pipeline-actions-ui";
import { ApiError, useApiClient, type Api } from "./session";
import { bookedByLabel, takenByLabel, indexRoles, matchesRole, resolveRole, ROLE_IDS, ROLE_LABEL, ROLE_SHORT, ROLE_TIP, SETTER_CLOSER_TIP, type RoleFilter, type RoleId, type RoleIndex } from "@/lib/people/roles";
import "./roles.css";

// Team role labels for every module. One shared read of GET people3/roles/map (60 seconds), so a chip next to a name costs nothing extra.
//   const roles = useRoles();  roles.roleOf(userId, locationId?)  ->  "setter" | "closer" | ... | null     roles.label(userId, locationId?)  ->  "Setter" | null
//   roles.has(userId, "setters", locationId?) filters by role (setters include people who are both)       roles.any  ->  true once anyone is a setter or closer (Appointments then say Setter/Closer)
//   <RoleChip userId={id} locationId={loc} />  draws the small label beside a name (nothing when no role is set)        <RolePicker userId name locationId />  the inline editor (managers only)
// When the roles feature is off, or the caller may not see the person, there is simply no label: nothing breaks and nothing is drawn.

type MapData = { roles: Record<string, { role: RoleId | null; byAccount: Record<string, RoleId> }>; any: boolean; canChange: boolean };
const EMPTY: MapData = { roles: {}, any: false, canChange: false };
type Store = { api: Api | null; at: number; data: MapData | null; p: Promise<void> | null; subs: Set<() => void> };
const store: Store = { api: null, at: 0, data: null, p: null, subs: new Set() };
const TTL = 60_000;

function fetchMap(api: Api, force = false): void {
  if (fixturesOn()) return;
  if (!force && store.api === api && store.p && Date.now() - store.at < TTL) return;
  store.api = api; store.at = Date.now();
  store.p = api.get<MapData>("people3/roles/map").then((d) => { store.data = d; }).catch(() => { store.data = EMPTY; }).finally(() => { store.subs.forEach((f) => f()); });
}
/** Call after any change of a role so every chip on screen reads the new label at once. */
export function refreshRoles(): void { if (store.api) fetchMap(store.api, true); }

export function useRoles() {
  const api = useApiClient();
  const [, tick] = useState(0);
  useEffect(() => {
    const f = () => tick((n) => n + 1);
    store.subs.add(f);
    fetchMap(api);
    return () => { store.subs.delete(f); };
  }, [api]);
  const data = store.data ?? EMPTY;
  const index: RoleIndex = indexRoles(Object.entries(data.roles).flatMap(([userId, v]) => [...(v.role ? [{ userId, locationId: "", role: v.role }] : []), ...Object.entries(v.byAccount).map(([locationId, role]) => ({ userId, locationId, role }))]));
  const roleOf = useCallback((userId: string | null | undefined, locationId?: string | null) => resolveRole(index, userId, locationId), [index]);
  return {
    ready: store.data !== null, any: data.any, canChange: data.canChange, roleOf,
    label: (userId: string | null | undefined, locationId?: string | null) => { const r = resolveRole(index, userId, locationId); return r ? ROLE_SHORT[r] : null; },
    has: (userId: string | null | undefined, f: RoleFilter, locationId?: string | null) => matchesRole(resolveRole(index, userId, locationId), f),
  };
}

/** The small label beside a name. Draws nothing when the person has no role. Hover or long-press explains what the word means. */
export function RoleChip({ userId, locationId, role }: { userId?: string | null; locationId?: string | null; role?: RoleId | null }) {
  const roles = useRoles();
  const r = role !== undefined ? role : roles.roleOf(userId, locationId);
  if (!r) return null;
  const tip = r === "setter" || r === "closer" ? `${ROLE_TIP[r]} (${SETTER_CLOSER_TIP})` : ROLE_TIP[r];
  return <span className="role-chip" data-role={r} title={tip} data-testid="role-chip">{ROLE_SHORT[r]}</span>;
}

type Preview = { ok?: boolean; preview?: { summary: string; changes: Array<{ label: string; from: string; to: string }>; more: number; confirm: { needed: boolean; words: string[] } } };
const msgOf = (e: unknown) => (e instanceof ApiError && typeof e.body.error === "string" ? e.body.error : e instanceof Error ? e.message : "Something went wrong. Nothing was changed.");
const FIELD = "min-h-11 w-full rounded-md border bg-background px-3 text-sm sm:min-h-9";

/** One role change: shows what would change, asks for the typed words when the change clears roles or touches many people, does it, then offers Undo. */
export function RoleChangeDialog(p: { title: string; userIds: string[]; role: RoleId | null; locationId?: string | null; onClose: () => void; onDone: () => void }) {
  const api = useApiClient();
  const [pre, setPre] = useState<Preview | null>(null), [typed, setTyped] = useState(""), [busy, setBusy] = useState(false), [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ message: string; batchId: string | null } | null>(null), [undone, setUndone] = useState(false);
  const body = { userIds: p.userIds, role: p.role, ...(p.locationId ? { locationId: p.locationId } : {}) };
  const key = JSON.stringify(body);
  useEffect(() => {
    let live = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPre(null); setErr(null);
    api.post<Preview>("people3/roles/set", { ...JSON.parse(key), step: "preview" }).then((r) => { if (live) setPre(r); }).catch((e) => { if (live) setErr(msgOf(e)); });
    return () => { live = false; };
  }, [api, key]);
  const words = pre?.preview?.confirm.needed ? pre.preview.confirm.words : null;
  const typedOk = !words || words.includes(typed.trim().toLowerCase().replace(/\s+/g, " "));
  const go = async () => {
    setBusy(true); setErr(null);
    try { const r = await api.post<{ message?: string; batchId?: string | null; changed?: number }>("people3/roles/set", { ...body, step: "do", ...(words ? { typed } : {}) }); setDone({ message: r.message ?? "Saved.", batchId: r.batchId ?? null }); refreshRoles(); p.onDone(); }
    catch (e) { setErr(msgOf(e)); } finally { setBusy(false); }
  };
  const undo = async () => {
    if (!done?.batchId) return;
    setBusy(true);
    try { await api.post("people3/roles/undo", { batchId: done.batchId, step: "do" }); setUndone(true); refreshRoles(); p.onDone(); } catch (e) { setErr(msgOf(e)); } finally { setBusy(false); }
  };
  const clearing = p.role === null;
  return (
    <Sheet title={p.title} onClose={p.onClose} testId="role-dialog">
      {done ? (
        <div role="status" data-testid="role-done">
          <p className="flex items-center gap-2 text-sm"><Check aria-hidden className="size-4" />{undone ? "Put back as it was." : done.message}</p>
          {err && <p role="alert" className="mt-2 text-sm text-destructive">{err}</p>}
          <div className="mt-3 flex flex-wrap gap-2">{done.batchId && !undone && <button type="button" className={BTN} onClick={() => void undo()} disabled={busy} data-testid="role-undo"><Undo2 aria-hidden className="size-4" />Undo</button>}<button type="button" className={PRIMARY} onClick={p.onClose}>Close</button></div>
        </div>
      ) : pre?.preview ? (
        <div data-testid="role-preview">
          <p className="text-sm font-medium">{pre.preview.summary}</p>
          {pre.preview.changes.length > 0 && <ul className="mt-2 divide-y rounded-md border text-sm">{pre.preview.changes.map((c, i) => <li key={`${c.label}:${i}`} className="flex flex-wrap gap-x-3 px-3 py-1.5"><span className="w-36 shrink-0 text-muted-foreground">{c.label}</span><span>{c.from} to <b>{c.to}</b></span></li>)}</ul>}
          {pre.preview.more > 0 && <p className="mt-1 text-xs text-muted-foreground">and {pre.preview.more} more.</p>}
          {words && <label className="mt-3 block text-sm">Type <b>{words[0]}</b>{words[1] ? <> or <b>{words[1]}</b></> : null} to confirm<input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false} className={`${FIELD} mt-1`} aria-label="Type the confirmation" data-testid="role-typed" /></label>}
          {err && <p role="alert" className="mt-2 text-sm text-destructive">{err}</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={() => void go()} disabled={busy || !typedOk || pre.preview.changes.length === 0} className={clearing ? DANGER : PRIMARY} data-testid="role-confirm">{busy ? <Loader2 aria-hidden className="size-4 animate-spin" /> : <Check aria-hidden className="size-4" />}{clearing ? "Clear the role" : "Save"}</button>
            <button type="button" onClick={p.onClose} className={BTN}>Cancel</button>
          </div>
        </div>
      ) : err ? (
        <div><p role="alert" className="text-sm text-destructive">{err}</p><div className="mt-3"><button type="button" onClick={p.onClose} className={BTN}>Close</button></div></div>
      ) : <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 aria-hidden className="size-4 animate-spin" />Checking what would change...</p>}
    </Sheet>
  );
}

/** The inline editor beside a person: the current label as a small button that opens a list of roles; choosing one shows the preview before anything is saved.
 *  Drawn only for people who may change roles; everyone else sees the plain chip. */
export function RolePicker({ userId, name, locationId, current, onChanged }: { userId: string; name: string; locationId?: string | null; current?: RoleId | null; onChanged?: () => void }) {
  const roles = useRoles();
  const [open, setOpen] = useState(false), [pick, setPick] = useState<{ role: RoleId | null } | null>(null), box = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    const c = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    window.addEventListener("keydown", k); window.addEventListener("mousedown", c);
    return () => { window.removeEventListener("keydown", k); window.removeEventListener("mousedown", c); };
  }, [open]);
  const role = current !== undefined ? current : roles.roleOf(userId, locationId);
  if (!roles.canChange) return <RoleChip userId={userId} locationId={locationId} role={role} />;
  return (
    <span className="role-pick" ref={box}>
      <button type="button" className="role-btn" aria-haspopup="listbox" aria-expanded={open} aria-label={`Role for ${name}: ${role ? ROLE_LABEL[role] : "not set"}. Change`} onClick={() => setOpen((o) => !o)} data-testid="role-picker" data-role={role ?? "none"}>
        {role ? ROLE_SHORT[role] : "Set role"}<ChevronDown aria-hidden className="size-3" />
      </button>
      {open && (
        <ul className="role-menu" role="listbox" aria-label="Choose a role">
          {ROLE_IDS.map((id) => <li key={id} role="option" aria-selected={role === id}><button type="button" title={ROLE_TIP[id]} onClick={() => { setOpen(false); if (id !== role) setPick({ role: id }); }}>{ROLE_LABEL[id]}{role === id ? <Check aria-hidden className="size-3" /> : null}</button></li>)}
          {role && <li role="option" aria-selected={false}><button type="button" className="role-clear" onClick={() => { setOpen(false); setPick({ role: null }); }}>No role</button></li>}
          <li className="role-help" aria-hidden>{SETTER_CLOSER_TIP}</li>
        </ul>
      )}
      {pick && <RoleChangeDialog title={`Role for ${name}`} userIds={[userId]} role={pick.role} locationId={locationId} onClose={() => setPick(null)} onDone={() => onChanged?.()} />}
    </span>
  );
}

/** The words Appointments use for the two people on an appointment: "Booked by" and "Assigned to" until someone has a Setter or Closer label, then "Setter" and "Closer" (with the one-line explanation as a tooltip). */
export function useApptRoleWords() {
  const roles = useRoles();
  return { anyRoles: roles.any, bookedBy: bookedByLabel(roles.any), takenBy: takenByLabel(roles.any), tip: roles.any ? SETTER_CLOSER_TIP : undefined, roles };
}
