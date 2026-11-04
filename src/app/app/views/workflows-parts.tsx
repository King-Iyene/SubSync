"use client";

import { ChevronLeft, ChevronRight, ExternalLink, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { LabelRow } from "@/lib/workflows/store-types";
import { BUCKET_LABEL, bucketOf, type Bucket } from "@/lib/workflows/reports";
import { entityOf, type WfItem } from "@/lib/workflows/model";
import { InlineAlert } from "../ds";
import { useApiClient } from "../session";
import { Badge, Btn } from "../ui";

// The pieces of the Workflows page that are not charts: the table, the one-item panel, and the change dialog (pick, preview, confirm).

export type Acc = { locationId: string; name: string };
export const keyOf = (w: Pick<WfItem, "locationId" | "workflowId">) => `${w.locationId}|${w.workflowId}`;
export const when = (ms: number | null, now: number): string => {
  if (!ms) return "";
  const d = Math.floor((now - ms) / 86_400_000);
  if (d <= 0) return "Today";
  if (d === 1) return "Yesterday";
  return d < 60 ? `${d} days ago` : new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
};
const TONE: Record<Bucket, "good" | "bad" | "warn" | "neutral"> = { running: "good", failing: "bad", never_run: "warn", draft: "neutral", stopped: "neutral" };
export const StateBadge = ({ bucket }: { bucket: Bucket }) => <Badge tone={TONE[bucket]}>{BUCKET_LABEL[bucket]}</Badge>;
const DEC = { keep: "Keep", review: "Review", retire: "Retire" } as const;

// ---------------------------------------------------------------- table

const GRID = "grid grid-cols-[2rem_minmax(12rem,1.7fr)_minmax(8rem,1fr)_8.5rem_6.5rem_6.5rem_4.5rem_4.5rem_4.5rem] items-center gap-x-3";
const PAGE = 50;

export function WfTable({ items, accounts, labels, failing, now, selected, onToggle, onToggleAll, onOpen, canSelect, initialState = "all" }: {
  items: WfItem[]; accounts: Acc[]; labels: Record<string, LabelRow>; failing: Set<string>; now: number; selected: Set<string>; onToggle: (k: string) => void; onToggleAll: (keys: string[], on: boolean) => void;
  onOpen: (w: WfItem) => void; canSelect: boolean; initialState?: Bucket | "all";
}) {
  const [q, setQ] = useState("");
  const [state, setState] = useState<Bucket | "all">(initialState);
  const [page, setPage] = useState(0);
  const name = useMemo(() => new Map(accounts.map((a) => [a.locationId, a.name])), [accounts]);
  const rows = useMemo(() => items.filter((w) => (state === "all" || bucketOf(w, failing) === state) && (!q || `${w.name} ${name.get(w.locationId) ?? ""}`.toLowerCase().includes(q.toLowerCase()))), [items, state, q, failing, name]);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const cur = Math.min(page, pages - 1);
  const shown = rows.slice(cur * PAGE, cur * PAGE + PAGE);
  const allOn = shown.length > 0 && shown.every((w) => selected.has(keyOf(w)));
  return (
    <div data-testid="wf-table">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <label className="relative min-w-[14rem] flex-1">
          <span className="sr-only">Search by name or client account</span>
          <Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} placeholder="Search by name or client account" data-testid="wf-search" className="h-10 w-full rounded-lg border bg-background pl-9 pr-3 text-sm" />
        </label>
        <label className="text-sm"><span className="sr-only">State</span>
          <select value={state} onChange={(e) => { setState(e.target.value as Bucket | "all"); setPage(0); }} data-testid="wf-state" className="h-10 rounded-lg border bg-background px-2 text-sm">
            <option value="all">Every state</option>
            {(Object.keys(BUCKET_LABEL) as Bucket[]).map((b) => <option key={b} value={b}>{BUCKET_LABEL[b]}</option>)}
          </select>
        </label>
        <span className="text-sm text-muted-foreground" aria-live="polite" data-testid="wf-count">{rows.length === items.length ? `${rows.length} shown` : `${rows.length} of ${items.length}`}</span>
      </div>
      <div className="overflow-x-auto rounded-xl border">
        <div className="min-w-[62rem]">
          <div className={`${GRID} border-b bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground`} role="row">
            <span>{canSelect ? <input type="checkbox" aria-label="Pick every row on this page" checked={allOn} onChange={(e) => onToggleAll(shown.map(keyOf), e.target.checked)} data-testid="wf-pick-all" className="size-4" /> : null}</span>
            <span>Name</span><span>Client account</span><span>State</span><span>Last edited</span><span>Last run</span><span className="text-right">Runs</span><span className="text-right">Errors</span><span>CRM</span>
          </div>
          {shown.length === 0 ? <p className="px-4 py-8 text-center text-sm text-muted-foreground">Nothing matches. Clear the search or the state.</p> : shown.map((w) => {
            const k = keyOf(w);
            const l = labels[k];
            return (
              <div key={k} className={`${GRID} min-h-12 border-b px-3 py-1.5 text-sm last:border-b-0 hover:bg-accent/40`} role="row" data-testid="wf-row">
                <span>{canSelect ? <input type="checkbox" aria-label={`Pick ${w.name}`} checked={selected.has(k)} onChange={() => onToggle(k)} data-testid="wf-pick" className="size-4" /> : null}</span>
                <span className="min-w-0">
                  <button type="button" onClick={() => onOpen(w)} className="block max-w-full truncate text-left font-medium hover:underline" data-testid="wf-open">{w.name}</button>
                  {l && (l.decision || l.rating || l.labels.length) ? <span className="block truncate text-xs text-muted-foreground">{[l.decision ? DEC[l.decision] : null, l.rating ? `${l.rating} of 5` : null, ...l.labels].filter(Boolean).join(" · ")}</span> : null}
                </span>
                <span className="truncate text-muted-foreground">{name.get(w.locationId) ?? ""}</span>
                <span><StateBadge bucket={bucketOf(w, failing)} /></span>
                <span className="text-muted-foreground">{when(w.updatedAt, now)}</span>
                <span className="text-muted-foreground">{w.runs30d === null ? "Not known" : w.runs30d === 0 ? "Never (30 days)" : when(w.lastRunAt, now) || "In 30 days"}</span>
                <span className="text-right" style={{ fontVariantNumeric: "tabular-nums" }}>{w.runs30d ?? ""}</span>
                <span className={`text-right ${w.failed30d ? "font-medium text-destructive" : ""}`} style={{ fontVariantNumeric: "tabular-nums" }}>{w.failed30d ?? ""}</span>
                <span>{w.uiUrl ? <a href={w.uiUrl} target="_blank" rel="noopener noreferrer" aria-label={`Open ${w.name} in your CRM`} className="inline-flex min-h-8 items-center gap-1 text-primary hover:underline">Open<ExternalLink aria-hidden className="size-3" /></a> : null}</span>
              </div>
            );
          })}
        </div>
      </div>
      {pages > 1 ? (
        <div className="mt-3 flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Page {cur + 1} of {pages}</span>
          <span className="flex gap-2">
            <button type="button" disabled={cur === 0} onClick={() => setPage(cur - 1)} aria-label="Previous page" data-testid="wf-prev" className="inline-flex size-9 items-center justify-center rounded-lg border disabled:opacity-40"><ChevronLeft aria-hidden className="size-4" /></button>
            <button type="button" disabled={cur >= pages - 1} onClick={() => setPage(cur + 1)} aria-label="Next page" data-testid="wf-next" className="inline-flex size-9 items-center justify-center rounded-lg border disabled:opacity-40"><ChevronRight aria-hidden className="size-4" /></button>
          </span>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- one item

export function ItemPanel({ item, account, label, bucket, now, canOrganise, onClose, onSaved }: { item: WfItem; account: string; label: LabelRow | undefined; bucket: Bucket; now: number; canOrganise: boolean; onClose: () => void; onSaved: () => void }) {
  const api = useApiClient();
  const [decision, setDecision] = useState<LabelRow["decision"]>(label?.decision ?? null);
  const [rating, setRating] = useState<number | null>(label?.rating ?? null);
  const [labels, setLabels] = useState(label?.labels.join(", ") ?? "");
  const [note, setNote] = useState(label?.note ?? "");
  const [owner, setOwner] = useState(label?.owner ?? "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.focus(); const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);
  const save = async () => {
    setBusy(true); setMsg(null);
    try {
      await api.put("workflows/labels", { items: [{ locationId: item.locationId, workflowId: item.workflowId }], patch: { decision, rating, labels: labels.split(",").map((s) => s.trim()).filter(Boolean), note: note || null, owner: owner || null } });
      setMsg({ ok: true, text: "Saved in SubSync. Nothing was changed in your CRM." });
      onSaved();
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); } finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" data-testid="wf-panel" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={item.name} className="h-full w-full max-w-md overflow-y-auto border-l bg-background p-5 shadow-xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0"><h2 className="break-words text-lg font-semibold leading-6">{item.name}</h2><p className="text-sm text-muted-foreground">{account} · {entityOf(item.workflowId) === "campaign" ? "Campaign" : "Workflow"}</p></div>
          <button type="button" onClick={onClose} aria-label="Close" data-testid="wf-panel-close" className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg border"><X aria-hidden className="size-4" /></button>
        </div>
        <dl className="mb-5 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <dt className="text-muted-foreground">State</dt><dd><StateBadge bucket={bucket} /></dd>
          <dt className="text-muted-foreground">Last edited</dt><dd>{when(item.updatedAt, now) || "Not known"}</dd>
          <dt className="text-muted-foreground">Runs in 30 days</dt><dd>{item.runs30d ?? "Not known"}</dd>
          <dt className="text-muted-foreground">Errors in 30 days</dt><dd>{item.failed30d ?? "Not known"}</dd>
        </dl>
        {item.uiUrl ? <a href={item.uiUrl} target="_blank" rel="noopener noreferrer" className="mb-5 inline-flex min-h-9 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium hover:bg-accent" data-testid="wf-panel-crm">Open in your CRM<ExternalLink aria-hidden className="size-3.5" /></a> : null}
        <h3 className="mb-2 text-sm font-semibold">Your notes (kept in SubSync only)</h3>
        {!canOrganise ? <p className="text-sm text-muted-foreground">Labels, ratings and notes are for administrators on the paid plan.{label ? ` Decision: ${label.decision ? DEC[label.decision] : "not set"}.` : ""}</p> : (
          <div className="space-y-3">
            <fieldset><legend className="mb-1 text-xs font-medium text-muted-foreground">What should happen to it?</legend>
              <div className="flex gap-2">{(["keep", "review", "retire"] as const).map((d) => <button key={d} type="button" aria-pressed={decision === d} onClick={() => setDecision(decision === d ? null : d)} data-testid={`wf-decision-${d}`} className={`min-h-9 flex-1 rounded-lg border text-sm ${decision === d ? "border-primary bg-accent font-medium" : ""}`}>{DEC[d]}</button>)}</div>
            </fieldset>
            <fieldset><legend className="mb-1 text-xs font-medium text-muted-foreground">Rating</legend>
              <div className="flex gap-1.5">{[1, 2, 3, 4, 5].map((n) => <button key={n} type="button" aria-pressed={rating === n} aria-label={`${n} out of 5`} onClick={() => setRating(rating === n ? null : n)} data-testid={`wf-rate-${n}`} className={`size-9 rounded-lg border text-sm ${rating === n ? "border-primary bg-accent font-medium" : ""}`}>{n}</button>)}</div>
            </fieldset>
            <label className="block text-sm"><span className="mb-1 block text-xs font-medium text-muted-foreground">Labels (separate with commas)</span><input value={labels} onChange={(e) => setLabels(e.target.value)} data-testid="wf-labels" className="h-10 w-full rounded-lg border bg-background px-3" /></label>
            <label className="block text-sm"><span className="mb-1 block text-xs font-medium text-muted-foreground">Who looks after it</span><input value={owner} onChange={(e) => setOwner(e.target.value)} maxLength={60} data-testid="wf-owner" className="h-10 w-full rounded-lg border bg-background px-3" /></label>
            <label className="block text-sm"><span className="mb-1 block text-xs font-medium text-muted-foreground">Note</span><textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={1000} data-testid="wf-note" className="w-full rounded-lg border bg-background px-3 py-2" /></label>
            <Btn variant="primary" onClick={save} disabled={busy} testId="wf-save">{busy ? "Saving..." : "Save"}</Btn>
            {msg ? <p role="status" className={`text-sm ${msg.ok ? "text-success" : "text-destructive"}`} data-testid="wf-save-msg">{msg.text}</p> : null}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- change dialog

export type ChangeKind = "rename" | "publish" | "unpublish" | "delete" | "clone";
type PRow = { workflowId: string; locationId: string; name: string; to: string | null; status: "change" | "unchanged" | "blocked"; problem: string | null; needsPause: boolean; maybeActive: boolean };
type Preview = { kind: ChangeKind; rows: PRow[]; count: number; problem: string | null; dryRun: boolean; token: string | null; phrase: string | null; pauses: number; active: number };
type Done = { results: Array<{ workflowId: string; locationId: string; name: string; outcome: string; message: string }>; dryRun: boolean };
const TITLE: Record<ChangeKind, string> = { rename: "Rename", publish: "Publish", unpublish: "Pause", delete: "Delete", clone: "Copy to another client account" };
const NEEDS: Record<ChangeKind, string[]> = { rename: ["workflows.readonly", "workflows.write"], publish: ["workflows.publish"], unpublish: ["workflows.publish"], delete: ["workflows.delete", "workflows.readonly"], clone: ["workflows.readonly", "workflows.write"] };
const OUT: Record<string, string> = { done: "Done", dry_run: "Not sent (live changes are off)", skipped: "Left alone", needs_permission: "Needs permission", conflict: "Not accepted", failed: "Failed" };

export function ChangeDialog({ kind, items, accounts, permitted, onClose, onChanged }: { kind: ChangeKind; items: WfItem[]; accounts: Acc[]; permitted: boolean; onClose: () => void; onChanged: () => void }) {
  const api = useApiClient();
  const [rule, setRule] = useState({ find: "", replace: "", prefix: "", suffix: "", casing: "none" as "none" | "title" });
  const [allowPaused, setAllowPaused] = useState(false);
  const [target, setTarget] = useState("");
  const [pv, setPv] = useState<Preview | null>(null);
  const [typed, setTyped] = useState("");
  const [active, setActive] = useState(false);
  const [done, setDone] = useState<Done | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.focus(); const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);
  const acc = new Map(accounts.map((a) => [a.locationId, a.name]));
  const payload = { kind, items: items.map((w) => ({ locationId: w.locationId, workflowId: w.workflowId })), rule, allowPaused, targetLocationId: target || undefined };
  const run = async (path: "preview" | "confirm") => {
    setBusy(true); setErr(null);
    try {
      if (path === "preview") { setPv(await api.post<Preview>("workflows/preview", payload)); setTyped(""); setActive(false); }
      else { setDone(await api.post<Done>("workflows/confirm", { ...payload, token: pv?.token, typed, confirmActive: active })); onChanged(); }
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const needsConfig = kind === "rename" || kind === "clone";
  const deleteReady = kind !== "delete" || (typed.trim() === pv?.phrase && (pv?.active === 0 || active));
  const canPreview = kind === "rename" ? Boolean(rule.find || rule.prefix || rule.suffix || rule.casing === "title") : kind === "clone" ? Boolean(target) : true;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" data-testid="wf-dialog" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={TITLE[kind]} className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border bg-background p-5 shadow-xl">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div><h2 className="text-lg font-semibold">{TITLE[kind]} {items.length} item{items.length === 1 ? "" : "s"}</h2><p className="text-sm text-muted-foreground">You see exactly what will change before anything is sent.</p></div>
          <button type="button" onClick={onClose} aria-label="Close" data-testid="wf-dialog-close" className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg border"><X aria-hidden className="size-4" /></button>
        </div>
        {!permitted ? <InlineAlert tone="warning" title="Needs permission: reconnect">SubSync needs {NEEDS[kind].join(" and ")}. Open SubSync again from your CRM's app list and accept it. Nothing else changes.</InlineAlert> : null}
        {done ? (
          <div data-testid="wf-result">
            {done.dryRun ? <InlineAlert tone="info" title="Nothing was sent">Live changes are switched off for this install, so this was a rehearsal. It is recorded in History.</InlineAlert> : null}
            <ul className="mt-3 divide-y rounded-xl border text-sm">{done.results.map((r) => <li key={r.workflowId + r.locationId} className="grid grid-cols-[1fr_auto] gap-3 px-3 py-2"><span className="min-w-0"><span className="block truncate font-medium">{r.name}</span><span className="block text-xs text-muted-foreground">{r.message}</span></span><span className="text-xs font-medium">{OUT[r.outcome] ?? r.outcome}</span></li>)}</ul>
            <div className="mt-4 flex justify-end"><Btn variant="primary" onClick={onClose} testId="wf-done">Close</Btn></div>
          </div>
        ) : (
          <>
            {kind === "rename" && !pv ? (
              <div className="grid gap-3 sm:grid-cols-2" data-testid="wf-rename-form">
                <label className="text-sm"><span className="mb-1 block text-xs font-medium text-muted-foreground">Find</span><input value={rule.find} onChange={(e) => setRule({ ...rule, find: e.target.value })} data-testid="wf-find" className="h-10 w-full rounded-lg border bg-background px-3" /></label>
                <label className="text-sm"><span className="mb-1 block text-xs font-medium text-muted-foreground">Replace with</span><input value={rule.replace} onChange={(e) => setRule({ ...rule, replace: e.target.value })} data-testid="wf-replace" className="h-10 w-full rounded-lg border bg-background px-3" /></label>
                <label className="text-sm"><span className="mb-1 block text-xs font-medium text-muted-foreground">Add at the start</span><input value={rule.prefix} onChange={(e) => setRule({ ...rule, prefix: e.target.value })} data-testid="wf-prefix" className="h-10 w-full rounded-lg border bg-background px-3" /></label>
                <label className="text-sm"><span className="mb-1 block text-xs font-medium text-muted-foreground">Add at the end</span><input value={rule.suffix} onChange={(e) => setRule({ ...rule, suffix: e.target.value })} data-testid="wf-suffix" className="h-10 w-full rounded-lg border bg-background px-3" /></label>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={rule.casing === "title"} onChange={(e) => setRule({ ...rule, casing: e.target.checked ? "title" : "none" })} className="size-4" />Capitalise Each Word</label>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={allowPaused} onChange={(e) => setAllowPaused(e.target.checked)} data-testid="wf-allow-paused" className="size-4" />Also pause and republish published ones</label>
              </div>
            ) : null}
            {kind === "clone" && !pv ? (
              <label className="block text-sm"><span className="mb-1 block text-xs font-medium text-muted-foreground">Copy into</span>
                <select value={target} onChange={(e) => setTarget(e.target.value)} data-testid="wf-target" className="h-10 w-full rounded-lg border bg-background px-2"><option value="">Pick a client account</option>{accounts.map((a) => <option key={a.locationId} value={a.locationId}>{a.name}</option>)}</select>
              </label>
            ) : null}
            {!needsConfig && !pv ? <p className="text-sm" data-testid="wf-simple">{kind === "delete" ? "Deleting is permanent in your CRM and ends anyone currently going through the workflow. SubSync saves a copy first so it can be recreated as a draft." : kind === "publish" ? "Published workflows start taking in new contacts." : "A paused workflow stops taking in new contacts."}</p> : null}
            {pv ? (
              <div data-testid="wf-preview">
                <ul className="divide-y rounded-xl border text-sm" aria-label="What will change">
                  {pv.rows.map((r) => (
                    <li key={r.workflowId + r.locationId} className="grid grid-cols-[1fr_1fr] gap-3 px-3 py-2" data-testid="wf-preview-row" data-status={r.status}>
                      <span className="min-w-0"><span className="block truncate">{r.name}</span><span className="block truncate text-xs text-muted-foreground">{acc.get(r.locationId) ?? ""}</span></span>
                      <span className="min-w-0">{r.status === "change" ? <span className="block truncate font-medium">{kind === "delete" ? "Will be deleted" : kind === "clone" ? `Copy named ${r.to}` : `to ${r.to}`}</span> : <span className="block text-xs text-muted-foreground">{r.status === "unchanged" ? "No change" : r.problem}</span>}
                        {r.status === "change" && r.needsPause && kind === "rename" ? <span className="block text-xs text-warning">Paused for a moment, then published again</span> : null}
                        {r.status === "change" && r.maybeActive ? <span className="block text-xs text-warning">Ran recently: people may still be inside (estimate)</span> : null}</span>
                    </li>
                  ))}
                </ul>
                {pv.problem ? <p className="mt-3 text-sm text-destructive" role="alert">{pv.problem}</p> : null}
                {pv.dryRun ? <p className="mt-3 text-xs text-muted-foreground">Live changes are off for this install: confirming records a rehearsal and sends nothing.</p> : null}
                {kind === "delete" && pv.count > 0 ? (
                  <div className="mt-3 space-y-2">
                    <label className="block text-sm"><span className="mb-1 block text-xs font-medium text-muted-foreground">Type <strong data-testid="wf-phrase">{pv.phrase}</strong> to confirm</span><input value={typed} onChange={(e) => setTyped(e.target.value)} data-testid="wf-typed" className="h-10 w-full rounded-lg border bg-background px-3" autoComplete="off" /></label>
                    {pv.active > 0 ? <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} data-testid="wf-active" className="mt-0.5 size-4" />I understand {pv.active} of these ran recently and anyone inside will stop where they are.</label> : null}
                  </div>
                ) : null}
              </div>
            ) : null}
            {err ? <p className="mt-3 text-sm text-destructive" role="alert" data-testid="wf-error">{err}</p> : null}
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <Btn variant="ghost" onClick={pv ? () => setPv(null) : onClose} testId="wf-back">{pv ? "Back" : "Cancel"}</Btn>
              {!pv ? <Btn variant="primary" onClick={() => run("preview")} disabled={busy || !permitted || !canPreview} testId="wf-preview-btn">{busy ? "Checking..." : "Preview changes"}</Btn>
                : <Btn variant="primary" onClick={() => run("confirm")} disabled={busy || pv.count === 0 || !pv.token || !deleteReady} testId="wf-confirm">{busy ? "Working..." : kind === "delete" ? `Delete ${pv.count}` : `Confirm ${pv.count} change${pv.count === 1 ? "" : "s"}`}</Btn>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: Array<{ id: T; label: string }>; value: T; onChange: (t: T) => void }): ReactNode {
  return (
    <div role="tablist" aria-label="Sections of this page" className="mb-6 flex gap-1 overflow-x-auto border-b" data-testid="wf-tabs">
      {tabs.map((t) => <button key={t.id} type="button" role="tab" aria-selected={value === t.id} onClick={() => onChange(t.id)} data-testid={`wf-tab-${t.id}`} className={`min-h-10 shrink-0 border-b-2 px-3 text-sm ${value === t.id ? "border-primary font-semibold" : "border-transparent text-muted-foreground hover:text-foreground"}`}>{t.label}</button>)}
    </div>
  );
}
