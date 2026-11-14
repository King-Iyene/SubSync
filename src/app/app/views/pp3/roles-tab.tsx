"use client";

import { Undo2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { RoleCounts, RolePerson, RoleLogRow } from "@/lib/analytics/team-roles-queries";
import { MIN_SUGGEST, ROLE_IDS, ROLE_LABEL, ROLE_SHORT, SETTER_CLOSER_TIP, type RoleId } from "@/lib/people/roles";
import { suggestionProgress } from "@/lib/people/team-empty";
import { EmptyState } from "../../ds";
import { RoleChangeDialog, RolePicker, refreshRoles } from "../../roles";
import { ApiError, useApiClient, useData } from "../../session";
import { BTN, PRIMARY } from "../appointment-actions-ui";
import { Sheet } from "../pipeline-actions-ui";
import { fixturesOn } from "./data";
import { Find, Load, NOT_ENOUGH, Pager, useCursor, useDebounced } from "./shared";

// Team > Roles: the agency's own label for each person (Setter, Closer, Both, Support, Manager, Other). The CRM has no such title, so it is kept only in SubSync and every screen reads it.
// A searchable list that works for 50 or 5,000 people (paged), filter by role, a "no role set" count, an inline picker on every row, a bulk change with a preview, a suggestion (an estimate, with
// its evidence) that is never applied by itself, and a log with Undo. Only managers reach this tab; the server decides again on every request.

type List = {
  rows: RolePerson[]; total: number; next: string | null; ready: boolean; counts: RoleCounts; filter: string; level: string;
  scopes: { everywhere: boolean; accounts: Array<{ locationId: string; name: string }> };
};
type Log = { rows: RoleLogRow[] };
const FILTERS: Array<[string, string]> = [["all", "Everyone"], ["setters", "Setters"], ["closers", "Closers"], ["manager", "Managers"], ["support", "Support"], ["other", "Other"], ["none", "No role set"]];
const CRM_ROLE: Record<string, string> = { agency_admin: "Admin", agency_staff: "Staff", account_admin: "Account admin", account_user: "Staff", unknown: "" };

function UndoSheet({ row, onClose, onDone }: { row: RoleLogRow; onClose: () => void; onDone: () => void }) {
  const api = useApiClient();
  const [pre, setPre] = useState<{ summary: string; changes: Array<{ label: string; from: string; to: string }> } | null>(null), [err, setErr] = useState<string | null>(null), [busy, setBusy] = useState(false), [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    api.post<{ preview: { summary: string; changes: Array<{ label: string; from: string; to: string }> } }>("people3/roles/undo", { batchId: row.batchId, step: "preview" }).then((r) => { if (live) setPre(r.preview); }).catch((e) => { if (live) setErr(e instanceof ApiError && typeof e.body.error === "string" ? e.body.error : "That change can no longer be put back."); });
    return () => { live = false; };
  }, [api, row.batchId]);
  const go = async () => {
    setBusy(true);
    try { const r = await api.post<{ message?: string }>("people3/roles/undo", { batchId: row.batchId, step: "do" }); setMsg(r.message ?? "Put back."); refreshRoles(); onDone(); } catch (e) { setErr(e instanceof ApiError && typeof e.body.error === "string" ? e.body.error : "Could not put it back."); } finally { setBusy(false); }
  };
  return (
    <Sheet title="Put this change back" onClose={onClose} testId="role-undo-sheet">
      {msg ? <p role="status" className="text-sm">{msg}</p> : pre ? <>
        <p className="text-sm font-medium">{pre.summary}</p>
        {pre.changes.length > 0 && <ul className="mt-2 divide-y rounded-md border text-sm">{pre.changes.map((c, i) => <li key={i} className="flex flex-wrap gap-x-3 px-3 py-1.5"><span className="w-36 shrink-0 text-muted-foreground">{c.label}</span><span>{c.from} to <b>{c.to}</b></span></li>)}</ul>}
        {err && <p role="alert" className="mt-2 text-sm text-destructive">{err}</p>}
        <div className="mt-3 flex gap-2"><button type="button" className={PRIMARY} onClick={() => void go()} disabled={busy || pre.changes.length === 0}>Put it back</button><button type="button" className={BTN} onClick={onClose}>Cancel</button></div>
      </> : err ? <p role="alert" className="text-sm text-destructive">{err}</p> : <p className="text-sm text-muted-foreground">Checking...</p>}
      {msg && <div className="mt-3"><button type="button" className={PRIMARY} onClick={onClose}>Close</button></div>}
    </Sheet>
  );
}

export function Roles() {
  const [q, setQ] = useState(""), [filter, setFilter] = useState("all"), [location, setLocation] = useState(""), [size, setSize] = useState(25);
  const dq = useDebounced(q), [sel, setSel] = useState<Set<string>>(new Set()), [bulkRole, setBulkRole] = useState<string>(""), [dlg, setDlg] = useState<{ title: string; ids: string[]; role: RoleId | null } | null>(null), [undo, setUndo] = useState<RoleLogRow | null>(null), [showLog, setShowLog] = useState(false);
  const key = JSON.stringify([dq, filter, location, size]), c = useCursor(key);
  const sp = new URLSearchParams({ size: String(size), role: filter });
  if (dq) sp.set("q", dq);
  if (location) sp.set("location", location);
  if (c.cursor) sp.set("after", c.cursor);
  const r = useData<List>(fixturesOn() ? null : `people3/roles/list?${sp.toString()}`);
  const log = useData<Log>(fixturesOn() || !showLog ? null : "people3/roles/log");
  const data = r.data;
  const everywhere = data?.scopes.everywhere ?? true, accounts = data?.scopes.accounts ?? [];
  // an account administrator has no "everywhere": their one account is preselected, so a label they set is for that account only
  const scopeLoc = location || (!everywhere && accounts.length === 1 ? accounts[0].locationId : "");
  const changed = () => { setSel(new Set()); r.reload(); if (showLog) log.reload(); };
  const pageIds = useMemo(() => data?.rows.map((p) => p.userId) ?? [], [data]);
  const allOn = pageIds.length > 0 && pageIds.every((id) => sel.has(id));
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const noRole = data?.counts.none ?? 0;
  const count = (f: string) => !data ? null : f === "all" ? data.counts.total : f === "none" ? data.counts.none : f === "setters" ? data.counts.setter + data.counts.both : f === "closers" ? data.counts.closer + data.counts.both : data.counts[f as RoleId];

  if (fixturesOn()) return <EmptyState title="Roles are not in the sample data" body="Roles are real labels for your own team, so there is nothing to show in sample mode." />;
  return (
    <div className="pp-stack" data-testid="pp-roles">
      <section className="pp-card" aria-label="About roles" style={{ width: "100%" }}>
        <h2 className="pp-h">Who does what</h2>
        <p className="ap-fine" data-testid="roles-explain">Your CRM has no title like setter or closer, so you choose one for each person. {SETTER_CLOSER_TIP} The label is kept only in SubSync (nothing changes in your CRM) and it is shown next to people&apos;s names on every screen.</p>
        {noRole > 0 && <p className="ap-note" role="status" data-testid="roles-none-count">{noRole.toLocaleString("en-US")} {noRole === 1 ? "person has" : "people have"} no role set. <button type="button" className="ap-link" onClick={() => setFilter("none")}>Show them</button></p>}
      </section>

      <div className="ap-head print:hidden" role="group" aria-label="Role filters">
        {FILTERS.map(([id, label]) => { const n = count(id); return <button key={id} type="button" className="s6-btn" data-active={filter === id ? "1" : undefined} aria-pressed={filter === id} onClick={() => setFilter(id)} data-testid={`roles-filter-${id}`}>{label}{n !== null ? ` (${n.toLocaleString("en-US")})` : ""}</button>; })}
      </div>
      <Find q={q} setQ={setQ} label="Search people by name">
        {(everywhere || accounts.length > 1) && (
          <select className="ap-field" aria-label="Where this role applies" value={location} onChange={(e) => setLocation(e.target.value)} data-testid="roles-scope">
            {everywhere && <option value="">Everywhere (the default)</option>}
            {accounts.map((a) => <option key={a.locationId} value={a.locationId}>Only in {a.name}</option>)}
          </select>
        )}
        <select className="ap-field" aria-label="People per page" value={size} onChange={(e) => setSize(Number(e.target.value))}>{[25, 50, 100].map((n) => <option key={n} value={n}>{n} per page</option>)}</select>
      </Find>
      {location && <p className="ap-fine">Showing the role each person has in this client account (its own, or the default when it has none). A role you set here applies to this account only.</p>}

      {sel.size > 0 && (
        <div className="role-bulk" role="region" aria-label="Change several people" data-testid="roles-bulk">
          <b>{sel.size} selected</b>
          <select className="ap-field" aria-label="Role for the selected people" value={bulkRole} onChange={(e) => setBulkRole(e.target.value)} data-testid="roles-bulk-role">
            <option value="">Choose a role</option>{ROLE_IDS.map((id) => <option key={id} value={id}>{ROLE_LABEL[id]}</option>)}<option value="none">No role (clear)</option>
          </select>
          <button type="button" className={PRIMARY} disabled={!bulkRole} onClick={() => setDlg({ title: `Role for ${sel.size} ${sel.size === 1 ? "person" : "people"}`, ids: [...sel], role: bulkRole === "none" ? null : (bulkRole as RoleId) })} data-testid="roles-bulk-review">Review the change</button>
          <button type="button" className={BTN} onClick={() => setSel(new Set())}>Clear the selection</button>
        </div>
      )}

      <Load r={r} empty={(x) => !x.ready ? "Roles need the latest database update, which has not run yet." : x.rows.length === 0 && (dq || filter !== "all" ? "Nobody matches. Clear the search or choose Everyone." : "People appear here once your team list has synced.")}>
        {(x) => (
          <>
            <div className="role-list" role="list" data-testid="roles-list">
              <div className="role-row role-head" role="presentation"><label className="role-check"><input type="checkbox" checked={allOn} onChange={() => setSel(allOn ? new Set() : new Set(pageIds))} aria-label="Select everyone on this page" /></label><span>Person</span><span>Role</span><span className="role-sug-h">Suggestion</span></div>
              {x.rows.map((p) => (
                <div className="role-row" role="listitem" key={p.userId} data-testid="roles-row">
                  <label className="role-check"><input type="checkbox" checked={sel.has(p.userId)} onChange={() => toggle(p.userId)} aria-label={`Select ${p.name}`} /></label>
                  <span className="role-who"><span className="ap-name">{p.name}</span>{CRM_ROLE[p.crmRole] ? <span className="ap-fine"> {CRM_ROLE[p.crmRole]}{p.overrides > 0 && !location ? `, ${p.overrides} account ${p.overrides === 1 ? "has its own role" : "have their own roles"}` : ""}</span> : null}</span>
                  <span><RolePicker userId={p.userId} name={p.name} locationId={scopeLoc || null} current={p.role} onChanged={changed} /></span>
                  <span className="role-sug">
                    {p.suggestion ? <>
                      <span className="ap-fine" title={p.suggestion.why}>Likely {ROLE_SHORT[p.suggestion.role].toLowerCase()} (an estimate). {p.suggestion.why}</span>
                      <button type="button" className="ap-link" onClick={() => setDlg({ title: `Role for ${p.name}`, ids: [p.userId], role: p.suggestion!.role })} data-testid="roles-use-suggestion">Use {ROLE_SHORT[p.suggestion.role]}</button>
                    </> : p.role ? null : <span className="ap-fine" data-testid="roles-no-suggestion">{NOT_ENOUGH} to suggest one: {suggestionProgress(p.actions, MIN_SUGGEST)} (appointments booked or taken in 90 days)</span>}
                  </span>
                </div>
              ))}
            </div>
            <Pager c={c} next={x.next} total={x.total} noun="people" />
          </>
        )}
      </Load>

      <section aria-label="Recent changes">
        <button type="button" className="ap-link" onClick={() => setShowLog((s) => !s)} aria-expanded={showLog} data-testid="roles-log-toggle">{showLog ? "Hide" : "Show"} recent changes</button>
        {showLog && <Load r={log} empty={(l) => l.rows.length === 0 && "No role has been changed yet."}>
          {(l) => (
            <ul className="role-log" data-testid="roles-log">{l.rows.map((row) => (
              <li key={row.batchId}><span>{new Date(row.at).toISOString().slice(0, 16).replace("T", " ")}</span>
                <span>{row.by ?? "Someone"}: {row.reason === "undo" ? "put back" : row.reason === "clear" ? "cleared" : "set"} {row.count} {row.count === 1 ? "role" : "roles"}{row.to ? ` to ${ROLE_LABEL[row.to]}` : ""} ({row.sample.join(", ")}{row.count > row.sample.length ? " and more" : ""})</span>
                {row.reason !== "undo" && <button type="button" className="ap-link" onClick={() => setUndo(row)}><Undo2 aria-hidden className="inline size-3" /> Undo</button>}</li>
            ))}</ul>
          )}
        </Load>}
      </section>

      {dlg && <RoleChangeDialog title={dlg.title} userIds={dlg.ids} role={dlg.role} locationId={scopeLoc || null} onClose={() => setDlg(null)} onDone={changed} />}
      {undo && <UndoSheet row={undo} onClose={() => setUndo(null)} onDone={changed} />}
    </div>
  );
}
