"use client";

import { ExternalLink } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Cl2List, Cl2Options, Cl2Row, Cl2View } from "@/lib/analytics/clients2-types";
import { useApiClient } from "../../session";
import { EmptyState, ErrorState, SkeletonRows } from "../../ds";
import { Find } from "../cl3/shared";
import { agoText, c2post, c2q, money, useC2, type C2 } from "./data";
import { LevelDot, PayChip } from "./chips";

// Accounts: every client account in one table. Search (name or email), filters (payment status, paid plan, health, kind of business, who looks after it, quiet), sort, saved views,
// keyset paging ("Show more": no page numbers, so rows never repeat or skip), and bulk actions with a preview. A row opens the account page inside SubSync; the small arrow opens your CRM.
// Bulk changes only touch SubSync's own settings (who looks after a client, quiet alerts, kind of business). Nothing is changed in your CRM and nobody is messaged.
export type Filter = { q: string; status: string; plan: string; level: string; vertical: string; manager: string; quiet: boolean; sort: string };
export const NO_FILTER: Filter = { q: "", status: "", plan: "", level: "", vertical: "", manager: "", quiet: false, sort: "attention" };
const SORTS: Array<[string, string]> = [["attention", "Needs a look first"], ["name", "Name"], ["status", "Payment status"], ["plan", "Paid plan"], ["activity", "Most quiet first"], ["health", "Health"], ["value", "Open deals value"]];
const BULK_CAP = 50;

const Sel = ({ label, value, set, options, any }: { label: string; value: string; set: (v: string) => void; options: Array<{ key: string; label: string; count: number }>; any: string }) => (
  <select className="ap-field" aria-label={label} value={value} onChange={(e) => set(e.target.value)}>
    <option value="">{any}</option>
    {options.map((o) => <option key={o.key} value={o.key}>{o.label} ({o.count})</option>)}
  </select>
);

const listQuery = (f: Filter, cursor: string | null, rev: number) => c2q("list", { q: f.q, status: f.status, plan: f.plan, level: f.level, vertical: f.vertical, manager: f.manager, quiet: f.quiet, sort: f.sort, size: 50, cursor, v: rev });

export function AccountsTab({ preset, onOpen, go, bulkOn }: { preset: Partial<Filter> | null; onOpen: (id: string) => void; go: (id: string) => void; bulkOn: boolean }) {
  const api = useApiClient();
  const [f, setF] = useState<Filter>({ ...NO_FILTER, ...(preset ?? {}) });
  const [dq, setDq] = useState(f.q);
  const [sel, setSel] = useState<Record<string, string>>({});
  const [bulk, setBulk] = useState<null | "manager" | "vertical" | "mute">(null);
  const [view, setView] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [rev, setRev] = useState(0);
  const preKey = useRef(JSON.stringify(preset));
  // A tile on the overview can send a filter in; take it once per change.
  useEffect(() => {
    const k = JSON.stringify(preset);
    if (k !== preKey.current) { preKey.current = k; setF({ ...NO_FILTER, ...(preset ?? {}) }); setDq(preset?.q ?? ""); }
  }, [preset]);
  useEffect(() => { const t = setTimeout(() => setF((x) => (x.q === dq ? x : { ...x, q: dq })), 300); return () => clearTimeout(t); }, [dq]);
  const opts = useC2<Cl2Options>(c2q("options") + `&v=${rev}`);
  const views = useC2<{ views: Cl2View[] }>(c2q("views") + `&v=${rev}`);
  const set = <K extends keyof Filter>(k: K, v: Filter[K]) => setF((x) => ({ ...x, [k]: v }));
  const picked = Object.keys(sel);
  const filtered = useMemo(() => JSON.stringify({ ...f, sort: "" }) !== JSON.stringify({ ...NO_FILTER, sort: "" }), [f]);

  const applyView = (id: string) => {
    setView(id);
    const v = views.data?.views.find((x) => x.id === id);
    if (v) { const nf = { ...NO_FILTER, ...v.filters, quiet: v.filters.quiet === "true" } as Filter; setF(nf); setDq(nf.q); }
  };
  const saveView = async () => {
    const name = window.prompt("Name this view (for example: Past due solar clients)");
    if (!name) return;
    try { await c2post(api, "view-save", { name, filters: { ...f, quiet: f.quiet ? "true" : "" } }); setMsg(`Saved the view "${name}".`); setRev((n) => n + 1); } catch (e) { setMsg(e instanceof Error ? e.message : "That did not work."); }
  };
  const dropView = async () => {
    const v = views.data?.views.find((x) => x.id === view);
    if (!v) return;
    const typed = window.prompt(`To delete this saved view, type its name: ${v.name}`);
    if (typed === null) return;
    try { await c2post(api, "view-delete", { id: v.id, confirm: typed }); setView(""); setMsg(`Deleted the view "${v.name}".`); setRev((n) => n + 1); } catch (e) { setMsg(e instanceof Error ? e.message : "That did not work."); }
  };

  return (
    <div data-testid="cl2-accounts">
      <Find q={dq} setQ={setDq}>
        <Sel label="Payment status" value={f.status} set={(v) => set("status", v)} options={opts.data?.status ?? []} any="Any payment status" />
        <Sel label="Paid plan" value={f.plan} set={(v) => set("plan", v)} options={opts.data?.plan ?? []} any="Any paid plan" />
        <Sel label="Health" value={f.level} set={(v) => set("level", v)} options={opts.data?.health ?? []} any="Any health" />
        {(opts.data?.vertical.length ?? 0) > 0 && <Sel label="Kind of business" value={f.vertical} set={(v) => set("vertical", v)} options={opts.data?.vertical ?? []} any="Any kind of business" />}
        {(opts.data?.manager.length ?? 0) > 0 && <Sel label="Who looks after it" value={f.manager} set={(v) => set("manager", v)} options={opts.data?.manager ?? []} any="Anyone looks after it" />}
        <label className="ap-fine inline-flex min-h-9 items-center gap-1.5"><input type="checkbox" checked={f.quiet} onChange={(e) => set("quiet", e.target.checked)} />Quiet {opts.data?.quietDays ?? 14}+ days</label>
        <select className="ap-field" aria-label="Sort by" value={f.sort} onChange={(e) => set("sort", e.target.value)}>{SORTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
      </Find>
      <div className="ap-head print:hidden" role="group" aria-label="Views and export">
        <select className="ap-field" aria-label="Saved views" value={view} onChange={(e) => applyView(e.target.value)}><option value="">Saved views{(views.data?.views.length ?? 0) ? ` (${views.data?.views.length})` : ""}</option>{views.data?.views.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select>
        <button type="button" className="ap-link" onClick={saveView} disabled={!filtered && f.sort === "attention"} data-testid="cl2-save-view">Save this view</button>
        {view && <button type="button" className="ap-link" onClick={dropView}>Delete this view</button>}
        {filtered && <button type="button" className="ap-link" onClick={() => { setF(NO_FILTER); setDq(""); setView(""); }}>Clear filters</button>}
        <button type="button" className="ap-link ml-auto" onClick={() => api.download(c2q("export", { q: f.q, status: f.status, plan: f.plan, level: f.level, vertical: f.vertical, manager: f.manager, quiet: f.quiet }), "client-accounts.csv")}>Export these to CSV</button>
      </div>
      {msg && <p className="ap-fine mb-2" role="status">{msg}</p>}
      {bulkOn && picked.length > 0 && (
        <div className="cl2-bulk print:hidden" role="region" aria-label="Selected client accounts" data-testid="cl2-bulk">
          <b>{picked.length} selected</b>
          <button type="button" className="s6-btn" onClick={() => setBulk(bulk === "manager" ? null : "manager")}>Who looks after them</button>
          <button type="button" className="s6-btn" onClick={() => setBulk(bulk === "vertical" ? null : "vertical")}>Kind of business</button>
          <button type="button" className="s6-btn" onClick={() => setBulk(bulk === "mute" ? null : "mute")}>Quiet alerts</button>
          <button type="button" className="ap-link" onClick={() => { setSel({}); setBulk(null); }}>Clear</button>
          {picked.length >= BULK_CAP && <span className="ap-fine">At most {BULK_CAP} at a time.</span>}
        </div>
      )}
      {bulk && picked.length > 0 && <BulkPanel kind={bulk} ids={picked} opts={opts.data ?? null} onDone={(m) => { setMsg(m); setBulk(null); setSel({}); setRev((n) => n + 1); }} onClose={() => setBulk(null)} />}
      {/* The list restarts (new key) whenever a filter, the sort or the data changes, so paging never mixes two different lists. */}
      <AccountList key={`${JSON.stringify(f)}|${rev}`} f={f} rev={rev} filtered={filtered} sel={bulkOn ? sel : null} setSel={setSel} onOpen={onOpen} go={go} />
    </div>
  );
}

function RowView({ r, sel, setSel, onOpen, go }: { r: Cl2Row; sel: Record<string, string> | null; setSel: (fn: (s: Record<string, string>) => Record<string, string>) => void; onOpen: (id: string) => void; go: (id: string) => void }) {
  const toggle = () => setSel((s) => { const n = { ...s }; if (n[r.locationId]) delete n[r.locationId]; else if (Object.keys(n).length < BULK_CAP) n[r.locationId] = r.name; return n; });
  return (
    <tr data-tone={r.plan.pay === "past_due" ? "amber" : undefined}>
      {sel && <td><input type="checkbox" aria-label={`Select ${r.name}`} checked={!!sel[r.locationId]} onChange={toggle} /></td>}
      <td><button type="button" className="ap-link ap-name" onClick={() => onOpen(r.locationId)} data-testid="cl2-row-open">{r.name}</button>{r.verticalLabel && <><br /><span className="ap-fine">{r.verticalLabel}</span></>}</td>
      <td>{r.plan.state === "ok" ? <>{r.plan.name ?? "Unnamed plan"}{r.plan.monthly !== null && <><br /><span className="ap-fine">{money(r.plan.monthly, r.plan.currency)} a month</span></>}</> : <span className="ap-fine">{r.plan.state === "no_plan" ? "None" : "Unknown"}</span>}</td>
      <td><PayChip plan={r.plan} />{r.plan.daysInStatus !== null && r.plan.pay !== "paid" && r.plan.pay !== "none" && <><br /><span className="ap-fine">{r.plan.daysInStatus === 0 ? "since today" : `${r.plan.daysInStatus} d in this status`}</span></>}</td>
      <td><LevelDot level={r.level} />{r.summary && <><br /><span className="ap-fine">{r.summary}</span></>}</td>
      <td>{r.lastActivityAt ? agoText(r.lastActivityAt) : <span className="ap-fine">None seen</span>}{r.quiet && <><br /><span className="ap-fine">Quiet</span></>}</td>
      <td>{r.manager ?? <span className="ap-fine">Nobody yet</span>}{r.people > 0 && <><br /><button type="button" className="ap-link ap-fine" onClick={() => go(r.locationId)}>{r.people} {r.people === 1 ? "person" : "people"}{r.peopleQuiet ? `, ${r.peopleQuiet} quiet` : ""}</button></>}</td>
      <td className="text-right"><span className="inline-flex items-center gap-2"><button type="button" className="s6-btn" data-kind="primary" onClick={() => onOpen(r.locationId)}>Open</button>{r.url && <a href={r.url} target="_blank" rel="noopener noreferrer" className="ap-link" aria-label={`Open ${r.name} in your CRM (new tab)`} title="Open in your CRM"><ExternalLink aria-hidden className="size-3.5" /></a>}</span></td>
    </tr>
  );
}

type ListProps = { f: Filter; rev: number; filtered: boolean; sel: Record<string, string> | null; setSel: (fn: (s: Record<string, string>) => Record<string, string>) => void; onOpen: (id: string) => void; go: (id: string) => void };

function AccountList(p: ListProps) {
  const { f, rev, filtered, sel, setSel } = p;
  const [chain, setChain] = useState<string[]>([]); // cursors of the extra pages, in order
  const first = useC2<Cl2List>(listQuery(f, null, rev));
  if (first.loading && !first.data) return <SkeletonRows rows={8} label="Loading client accounts..." />;
  if (first.error || !first.data) return first.error ? <ErrorState error={first.error} onRetry={first.reload} /> : null;
  const d = first.data;
  if (d.total === 0) return <EmptyState title={filtered ? "No client account matches these filters" : "No client accounts yet"} body={filtered ? "Clear a filter to see more." : "Client accounts appear here after the first read finishes."} />;
  const allOn = d.rows.length > 0 && d.rows.slice(0, BULK_CAP).every((r) => sel?.[r.locationId]);
  const head = (more: string | null) => (
    <>
      <p className="ap-fine mb-2" data-testid="cl2-count">{d.total.toLocaleString("en-US")} {d.total === 1 ? "client account" : "client accounts"}{filtered ? ` of ${d.all.toLocaleString("en-US")}` : ""}.</p>
      {more}
    </>
  );
  return (
    <>
      {head(null)}
      <div className="ap-scroll">
        <table className="ap-t cl2-t" data-testid="cl2-table">
          <thead><tr>
            {sel && <th className="w-8"><input type="checkbox" aria-label="Select the first 50 shown" checked={allOn} onChange={() => setSel(() => (allOn ? {} : Object.fromEntries(d.rows.slice(0, BULK_CAP).map((r) => [r.locationId, r.name]))))} /></th>}
            <th>Client account</th><th>Paid plan</th><th>Payment status</th><th>Health</th><th>Last activity</th><th>Looked after by</th><th className="text-right">Open</th>
          </tr></thead>
          <tbody>
            {d.rows.map((r) => <RowView key={r.locationId} r={r} sel={sel} setSel={setSel} onOpen={p.onOpen} go={p.go} />)}
            {chain.map((c, i) => <MoreRows key={c} f={f} rev={rev} cursor={c} last={i === chain.length - 1} cols={sel ? 8 : 7} rowProps={{ sel, setSel, onOpen: p.onOpen, go: p.go }} onMore={(n) => setChain((x) => [...x, n])} />)}
          </tbody>
        </table>
      </div>
      <div className="cl-pager print:hidden">
        {chain.length === 0 && (d.next ? <button type="button" className="s6-btn" onClick={() => setChain([d.next as string])} data-testid="cl2-more">Show more</button> : <span className="ap-fine">That is all of them.</span>)}
      </div>
    </>
  );
}

function MoreRows({ f, rev, cursor, last, cols, rowProps, onMore }: { f: Filter; rev: number; cursor: string; last: boolean; cols: number; rowProps: Omit<React.ComponentProps<typeof RowView>, "r">; onMore: (c: string) => void }) {
  const r = useC2<Cl2List>(listQuery(f, cursor, rev));
  if (r.loading && !r.data) return <tr><td colSpan={cols} className="ap-fine">Loading more...</td></tr>;
  if (r.error || !r.data) return <tr><td colSpan={cols}><button type="button" className="ap-link" onClick={r.reload}>Could not load more. Try again.</button></td></tr>;
  return (
    <>
      {r.data.rows.map((x) => <RowView key={x.locationId} r={x} {...rowProps} />)}
      {last && <tr><td colSpan={cols}>{r.data.next ? <button type="button" className="s6-btn" onClick={() => onMore(r.data!.next as string)} data-testid="cl2-more">Show more</button> : <span className="ap-fine">That is all of them.</span>}</td></tr>}
    </>
  );
}

// ---- the bulk panel: choose, preview what will change, then apply ----
function BulkPanel({ kind, ids, opts, onDone, onClose }: { kind: "manager" | "vertical" | "mute"; ids: string[]; opts: C2<Cl2Options> | null; onDone: (m: string) => void; onClose: () => void }) {
  const api = useApiClient();
  const [name, setName] = useState(""), [vertical, setVertical] = useState(""), [mkind, setMkind] = useState("replies"), [days, setDays] = useState(7);
  const [line, setLine] = useState<string | null>(null), [err, setErr] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const payload = (step: "preview" | "do") => (kind === "vertical"
    ? { path: "clients2/tag", body: { locations: ids, vertical: vertical || null, step } }
    : kind === "manager" ? { path: "clients/act/bulk", body: { locations: ids, what: "owner", name: name.trim() || null, step } }
    : { path: "clients/act/bulk", body: { locations: ids, what: "mute", muteKind: mkind, days, step } });
  const run = async (step: "preview" | "do") => {
    setErr(null); setBusy(true);
    try {
      const p = payload(step);
      const r = await api.post<{ line?: string; message?: string }>(p.path, p.body);
      if (step === "preview") setLine(r.line ?? "Ready."); else onDone(r.message ?? "Done.");
    } catch (e) { setErr(e instanceof Error ? e.message : "That did not work."); } finally { setBusy(false); }
  };
  const change = (fn: () => void) => { fn(); setLine(null); };
  return (
    <section className="cl-drill print:hidden" aria-label="Change the selected client accounts" data-testid="cl2-bulk-panel">
      <div className="mb-2 flex flex-wrap items-center gap-3"><h3 className="text-base font-semibold">{kind === "manager" ? "Who looks after them" : kind === "vertical" ? "Kind of business" : "Quiet alerts"} ({ids.length} selected)</h3><span className="ap-fine">Only changes what SubSync shows you. Nothing is changed in your CRM and nobody is messaged.</span><button type="button" className="ap-link ml-auto" onClick={onClose}>Close</button></div>
      <div className="flex flex-wrap items-center gap-2">
        {kind === "manager" && <input className="ap-field" aria-label="Name of the person who looks after them" placeholder="A name (leave empty to clear)" value={name} maxLength={60} onChange={(e) => change(() => setName(e.target.value))} />}
        {kind === "vertical" && <select className="ap-field" aria-label="Kind of business" value={vertical} onChange={(e) => change(() => setVertical(e.target.value))}><option value="">Clear the kind</option>{opts?.verticals.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}</select>}
        {kind === "mute" && <>
          <select className="ap-field" aria-label="What to quiet" value={mkind} onChange={(e) => change(() => setMkind(e.target.value))}><option value="all">Everything</option><option value="replies">Leads waiting for a reply</option><option value="noshows">No-shows</option><option value="stale">Quiet deals</option><option value="renewal">Renewal</option></select>
          <select className="ap-field" aria-label="For how long" value={days} onChange={(e) => change(() => setDays(Number(e.target.value)))}>{[7, 14, 30, 60, 90].map((d) => <option key={d} value={d}>{d} days</option>)}</select>
        </>}
        <button type="button" className="s6-btn" onClick={() => run("preview")} disabled={busy} data-testid="cl2-bulk-preview">Preview</button>
        {line && <button type="button" className="s6-btn" data-kind="primary" onClick={() => run("do")} disabled={busy} data-testid="cl2-bulk-apply">Apply</button>}
      </div>
      {line && <p className="mt-2 text-sm" role="status" data-testid="cl2-bulk-line">{line}</p>}
      {err && <p className="mt-2 text-sm text-destructive" role="alert">{err}</p>}
    </section>
  );
}
