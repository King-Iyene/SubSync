"use client";

import { ExternalLink, Search, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fmtMoney } from "@/lib/analytics/payments-format";
import type { PmItem, PmOptions, PmQueue, PmRow } from "@/lib/analytics/payments-types";
import { EmptyState, OpenLeadButton, SkeletonRows } from "../../ds";
import { useApiClient } from "../../session";
import { fixturesOn, queryOf, usePm, type PmParams } from "./data";
import { sample } from "./fixtures";
import { Load, days, day } from "./shared";

// The Recovery queue: ONE ranked list of money that needs action (failed payments, late invoices, past due plans, failed repeat payments). Every row has an Open button; a row opens the side
// panel (timeline, reminder text to copy, mark contacted, put aside, dismiss). SubSync sends nothing. Paging is keyset ("Show more"); the count at the top is the number of rows behind the filters.
export type QFilters = { problem: string; status: string; currency: string; age: string; location: string; q: string; min: string; max: string; test: boolean; from: string; to: string };
export const NO_FILTERS: QFilters = { problem: "", status: "open", currency: "", age: "", location: "", q: "", min: "", max: "", test: false, from: "", to: "" };
const PROBLEMS: Array<[string, string]> = [["", "Everything"], ["failed", "Failed payments"], ["late_invoice", "Late invoices"], ["past_due_plan", "Past due plans"], ["refund", "Refunds (30 days)"]];
const STATUSES: Array<[string, string]> = [["open", "To do"], ["contacted", "Contacted"], ["snoozed", "Put aside"], ["dismissed", "Dismissed"], ["all", "All"]];
const AGES: Array<[string, string]> = [["", "Any age"], ["0-3", "0 to 3 days"], ["4-7", "4 to 7 days"], ["8-14", "8 to 14 days"], ["15-30", "15 to 30 days"], ["31+", "Over 30 days"]];
const VIEWS_KEY = "pm.views";
type SavedView = { name: string; f: QFilters };
const loadViews = (): SavedView[] => { try { const v = JSON.parse(localStorage.getItem(VIEWS_KEY) ?? "[]"); return Array.isArray(v) ? v.slice(0, 12) : []; } catch { return []; } };
const saveViews = (v: SavedView[]) => { try { localStorage.setItem(VIEWS_KEY, JSON.stringify(v.slice(0, 12))); } catch { /* private window: the views just do not stay */ } };

const paramsOf = (f: QFilters): PmParams => ({ problem: f.problem, status: f.status === "open" ? "" : f.status, currency: f.currency, age: f.age, location: f.location, q: f.q, min: f.min, max: f.max, test: f.test, from: f.from, to: f.to });

function RowCard({ r, onOpen }: { r: PmRow; onOpen: (r: PmRow) => void }) {
  const hasContact = !!r.contactId;
  return (
    <li className="pm-row" data-pri={r.priority} data-testid="pm-row">
      <div>
        <button type="button" className="pm-who ap-link" onClick={() => onOpen(r)} data-testid="pm-row-open-panel">{r.who ?? "Customer"}</button>
        <div className="pm-sub">{r.accountName}{r.email ? ` - ${r.email}` : ""}</div>
        {!r.liveMode && <span className="ap-chip">Test payment</span>}
      </div>
      <div>
        <div className="pm-amt">{fmtMoney(r.amount, r.currency)}</div>
        <div className="pm-sub">{days(r.ageDays)} open</div>
      </div>
      <div>
        <span className="ap-chip" data-tone={r.priority === "high" ? "amber" : undefined}>{r.problemLabel}</span>{r.status !== "open" && <span className="ap-chip ml-1">{r.status === "contacted" ? "Contacted" : `Put aside until ${day(r.snoozedUntil)}`}</span>}
        <div className="pm-sub">{r.next}</div>
      </div>
      <div className="pm-end">
        <OpenLeadButton seed={hasContact ? { contactId: r.contactId as string, locationId: r.locationId, name: r.who ?? "Customer", locationName: r.accountName, email: r.email, url: r.crmUrl ?? undefined } : null} crmUrl={r.crmUrl} name={r.who ?? "this row"}
          reason={hasContact ? null : r.problem === "past_due_plan" ? "This is about the client account itself, so it opens in your CRM." : "No person is linked to this row. Open it in your CRM."} testId="pm-open" />
      </div>
    </li>
  );
}

export function QueueTab({ initial, options, rev, bump }: { initial: QFilters; options: PmOptions | null; rev: number; bump: () => void }) {
  const api = useApiClient(), sample1 = fixturesOn();
  const [f, setF] = useState<QFilters>(initial), [q, setQ] = useState(initial.q), [views, setViews] = useState<SavedView[]>([]);
  const [rows, setRows] = useState<PmRow[]>([]), [next, setNext] = useState<string | null>(null), [head, setHead] = useState<Pick<PmQueue, "total" | "totals"> | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "error">("loading"), [more, setMore] = useState(false), [open, setOpen] = useState<PmRow | null>(null), [nonce, setNonce] = useState(0);
  const seq = useRef(0);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setViews(loadViews()); }, []);
  useEffect(() => { const t = setTimeout(() => setF((x) => (x.q === q ? x : { ...x, q })), 300); return () => clearTimeout(t); }, [q]);
  const key = JSON.stringify(f);
  const load = useCallback(async (cursor: string | null) => {
    const my = ++seq.current;
    const get = async (): Promise<PmQueue> => (sample1 ? (sample("queue", { ...paramsOf(f) }, false) as PmQueue) : api.get<PmQueue>(queryOf("queue", { ...paramsOf(f), cursor, size: 25 })));
    try {
      const r = await get();
      if (my !== seq.current) return;
      setRows((x) => (cursor ? [...x, ...r.rows] : r.rows)); setNext(r.next); if (!cursor) setHead({ total: r.total, totals: r.totals }); setState("ok");
    } catch { if (my === seq.current) setState("error"); }
    if (my === seq.current) setMore(false);
  }, [api, f, sample1]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setState("loading"); void load(null); }, [key, rev, nonce, load]);

  const set = (patch: Partial<QFilters>) => setF((x) => ({ ...x, ...patch }));
  const accounts = options?.accounts ?? [], currencies = options?.currencies ?? [];
  const changed = useMemo(() => JSON.stringify({ ...f, q: "" }) !== JSON.stringify({ ...NO_FILTERS }) || f.q !== "", [f]);
  // The name is typed in a small form on the page: a browser pop-up is blocked inside some embedded frames and then does nothing.
  const [naming, setNaming] = useState<string | null>(null);
  const saveView = () => { const name = (naming ?? "").trim(); if (!name) return; const v = [...views.filter((x) => x.name !== name), { name: name.slice(0, 40), f }]; setViews(v); saveViews(v); setNaming(null); };
  const dropView = (name: string) => { const v = views.filter((x) => x.name !== name); setViews(v); saveViews(v); };

  return (
    <div className="pm-stack" data-testid="pm-queue">
      <div className="pm-filters" role="group" aria-label="Filters">
        <label className="ap-search"><Search aria-hidden className="size-4" /><span className="sr-only">Search by customer name or email</span><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or email" data-testid="pm-search" /></label>
        <select className="ap-field" aria-label="Type" value={f.problem} onChange={(e) => set({ problem: e.target.value })}>{PROBLEMS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <select className="ap-field" aria-label="Status" value={f.status} onChange={(e) => set({ status: e.target.value })}>{STATUSES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        {accounts.length > 1 && <select className="ap-field" aria-label="Client account" value={f.location} onChange={(e) => set({ location: e.target.value })}><option value="">All client accounts</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>}
        {currencies.length > 1 && <select className="ap-field" aria-label="Currency" value={f.currency} onChange={(e) => set({ currency: e.target.value })}><option value="">All currencies</option>{currencies.map((c) => <option key={c} value={c}>{c}</option>)}</select>}
        <select className="ap-field" aria-label="How long open" value={f.age} onChange={(e) => set({ age: e.target.value })}>{AGES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <input className="ap-field pm-num" inputMode="decimal" aria-label="Smallest amount" placeholder="Min amount" value={f.min} onChange={(e) => set({ min: e.target.value.replace(/[^0-9.]/g, "") })} />
        <input className="ap-field pm-num" inputMode="decimal" aria-label="Largest amount" placeholder="Max amount" value={f.max} onChange={(e) => set({ max: e.target.value.replace(/[^0-9.]/g, "") })} />
        <label className="ap-fine inline-flex items-center gap-1"><input type="checkbox" checked={f.test} onChange={(e) => set({ test: e.target.checked })} /> Show test payments</label>
      </div>
      <div className="pm-views" aria-label="Saved views">
        {naming === null ? <button type="button" className="s6-btn" onClick={() => setNaming("")} disabled={!changed}>Save this view</button> : (
          <form className="inline-flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); saveView(); }}>
            <input className="ap-field" autoFocus maxLength={40} aria-label="Name this view" placeholder="Name this view" value={naming} onChange={(e) => setNaming(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") setNaming(null); }} />
            <button type="submit" className="s6-btn" data-kind="primary" disabled={!naming.trim()}>Save</button>
            <button type="button" className="ap-link" onClick={() => setNaming(null)}>Cancel</button>
          </form>
        )}
        {views.map((v) => <span key={v.name} className="ap-chip"><button type="button" className="ap-link" onClick={() => { setF(v.f); setQ(v.f.q); }}>{v.name}</button> <button type="button" className="ap-link" aria-label={`Remove the view ${v.name}`} onClick={() => dropView(v.name)}><X aria-hidden className="inline size-3" /></button></span>)}
        {changed && <button type="button" className="ap-link" onClick={() => { setF(NO_FILTERS); setQ(""); }}>Clear filters</button>}
        {!sample1 && <button type="button" className="ap-link ml-auto" onClick={() => void api.download(queryOf("export", paramsOf(f)), "payments.csv")}>Export CSV</button>}
      </div>
      {head && <div className="pm-totals" data-testid="pm-totals"><b data-testid="pm-total">{head.total.toLocaleString("en-US")}</b><span>{head.total === 1 ? "item" : "items"}</span>{head.totals.map((t) => <span key={t.currency}>{fmtMoney(t.amount, t.currency)} ({t.count})</span>)}</div>}
      {state === "loading" && <SkeletonRows rows={5} label="Loading the list..." />}
      {state === "error" && <EmptyState title="Could not load the list" body="Check your connection and try again." action={<button type="button" className="s6-btn" onClick={() => setNonce((n) => n + 1)}>Try again</button>} />}
      {state === "ok" && rows.length === 0 && <EmptyState title={changed ? "Nothing matches these choices" : "No payment needs action"} body={changed ? "Clear a filter to see more." : "Failed payments, late invoices and past due plans appear here as soon as we find them."} />}
      {state === "ok" && rows.length > 0 && <ul className="pm-list" aria-label="Payments that need action">{rows.map((r) => <RowCard key={r.key} r={r} onOpen={setOpen} />)}</ul>}
      {next && <div className="pm-more"><button type="button" className="s6-btn" disabled={more} onClick={() => { setMore(true); void load(next); }} data-testid="pm-more">{more ? "Loading..." : "Show more"}</button><span className="ap-fine">{rows.length.toLocaleString("en-US")} shown</span></div>}
      {open && <ItemPanel row={open} onClose={() => setOpen(null)} onChanged={() => { bump(); setOpen(null); }} />}
    </div>
  );
}

function ItemPanel({ row, onClose, onChanged }: { row: PmRow; onClose: () => void; onChanged: () => void }) {
  const api = useApiClient(), sample1 = fixturesOn();
  const r = usePm<PmItem>("item", { loc: row.locationId, kind: row.kind, id: row.itemId });
  const [msg, setMsg] = useState<string | null>(null), [err, setErr] = useState<string | null>(null), [tone, setTone] = useState(0), [text, setText] = useState<string | null>(null);
  const [reason, setReason] = useState(""), [note, setNote] = useState(""), [confirmSend, setConfirmSend] = useState<null | { lines: Array<{ field: string; after: string }>; note: string }>(null), [typed, setTyped] = useState("");
  const msgs = r.data?.messages ?? [], shown = text ?? msgs[tone]?.text ?? "";
  const act = async (body: Record<string, unknown>, done: string) => {
    setErr(null); setMsg(null);
    if (sample1) return setErr("Sample data cannot be changed.");
    try { await api.post("payments/act/note", { location: row.locationId, kind: row.kind, id: row.itemId, ...body }); setMsg(done); if (body.action !== "note") setTimeout(onChanged, 600); else r.reload(); } catch (e) { setErr(e instanceof Error ? e.message : "That did not work."); }
  };
  const copy = async () => { try { await navigator.clipboard.writeText(shown); setMsg("Copied. SubSync sends nothing: paste it where you write to the customer."); } catch { setErr("Could not copy. Select the text and copy it yourself."); } };
  const resend = async (step: "preview" | "do") => {
    setErr(null);
    try { const out = await api.post<{ lines?: Array<{ field: string; after: string }>; note?: string; dryRun?: boolean }>("payments/act/resend", { location: row.locationId, id: row.itemId, step, confirm: typed }); if (step === "preview") setConfirmSend({ lines: out.lines ?? [], note: out.note ?? "" }); else { setMsg(out.dryRun ? "Checked. Sending is switched off, so nothing was sent." : "Sent."); setConfirmSend(null); } } catch (e) { setErr(e instanceof Error ? e.message : "That did not work."); }
  };
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);
  return (
    <>
      <button type="button" className="pm-scrim" aria-label="Close" onClick={onClose} />
      <aside className="pm-side" role="dialog" aria-modal="true" aria-label={`${row.problemLabel}: ${row.who ?? "customer"}`} data-testid="pm-panel">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0"><h2 className="text-lg font-semibold break-words">{row.who ?? "Customer"}</h2><p className="pm-sub">{row.accountName} - {row.problemLabel}</p></div>
          <button type="button" className="s6-btn" onClick={onClose} aria-label="Close the panel"><X aria-hidden className="size-4" /></button>
        </div>
        <div className="pm-card">
          <p className="pm-amt text-xl">{fmtMoney(row.amount, row.currency)}</p>
          <p className="pm-sub">{days(row.ageDays)} open{row.since ? `, since ${day(row.since)}` : ""}{row.planName ? `, plan: ${row.planName}` : ""}</p>
          <p className="mt-2 text-sm">{row.reason}</p>
          <p className="mt-1 text-sm"><b>Next step:</b> {row.next}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <OpenLeadButton seed={row.contactId ? { contactId: row.contactId, locationId: row.locationId, name: row.who ?? "Customer", locationName: row.accountName, email: row.email, url: row.crmUrl ?? undefined } : null} crmUrl={row.crmUrl} name={row.who ?? "this row"} reason={row.contactId ? null : "No person is linked. Open it in your CRM."} testId="pm-panel-open" />
            {row.crmUrl && <a className="s6-btn inline-flex items-center gap-1" href={row.crmUrl} target="_blank" rel="noopener noreferrer">Open in your CRM <ExternalLink aria-hidden className="size-3.5" /></a>}
          </div>
        </div>
        <Load r={r} label="Loading the history...">
          {(d) => (
            <>
              <section aria-label="Message to copy" className="pm-card">
                <h3 className="pm-h mb-2">A message you can copy</h3>
                <div className="mb-2 flex flex-wrap gap-2" role="tablist" aria-label="Tone">{d.messages.map((m, i) => <button key={m.tone} type="button" role="tab" aria-selected={tone === i} className="s6-btn" data-kind={tone === i ? "primary" : undefined} onClick={() => { setTone(i); setText(null); }}>{m.label}</button>)}</div>
                <textarea className="pm-text" aria-label="Message text you can edit" value={shown} onChange={(e) => setText(e.target.value)} data-testid="pm-message" />
                <div className="mt-2 flex flex-wrap items-center gap-2"><button type="button" className="s6-btn" data-kind="primary" onClick={() => void copy()}>Copy message</button><span className="ap-fine">SubSync sends nothing. You send it yourself.</span></div>
              </section>
              <section aria-label="What happened" className="pm-card">
                <h3 className="pm-h mb-2">What happened</h3>
                {d.events.length === 0 ? <p className="ap-fine">History starts the day we first saw this.</p> : <ol className="pm-time">{d.events.map((e, i) => <li key={i}><b>{day(e.at)}</b> {e.from ? `${e.from} to ` : ""}{e.status}{e.amount !== null ? `, ${fmtMoney(e.amount, e.currency)}` : ""}</li>)}</ol>}
                {d.notes.length > 0 && <ul className="pm-time mt-3">{d.notes.map((n) => <li key={n.id}><b>{day(n.at)}</b> {n.action === "contacted" ? "Marked as contacted" : n.action === "snooze" ? `Put aside until ${day(n.until)}` : n.action === "dismiss" ? `Dismissed: ${n.reason ?? ""}` : "Note"}{n.note ? ` - ${n.note}` : ""}{n.by ? ` (${n.by})` : ""}</li>)}</ul>}
              </section>
              <section aria-label="Your actions" className="pm-card">
                <h3 className="pm-h mb-2">Your next move</h3>
                <label className="ap-fine block">Note (optional)<input className="ap-field mt-1 w-full" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder="For example: called, left a voicemail" /></label>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button type="button" className="s6-btn" onClick={() => void act({ action: "contacted", note }, "Marked as contacted.")}>Mark as contacted</button>
                  <button type="button" className="s6-btn" onClick={() => void act({ action: "snooze", days: 3 }, "Put aside for 3 days.")}>Put aside 3 days</button>
                  <button type="button" className="s6-btn" onClick={() => void act({ action: "snooze", days: 7 }, "Put aside for 7 days.")}>Put aside 7 days</button>
                </div>
                <label className="ap-fine mt-3 block">Dismiss: say why<input className="ap-field mt-1 w-full" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} placeholder="For example: paid by bank transfer" /></label>
                <button type="button" className="s6-btn mt-2" disabled={!reason.trim()} onClick={() => void act({ action: "dismiss", reason }, "Dismissed.")}>Dismiss</button>
                {d.canResend && <div className="mt-3 border-t pt-3"><p className="ap-fine mb-1">{d.resendNote}</p>{!confirmSend ? <button type="button" className="s6-btn" onClick={() => void resend("preview")}>Send the invoice again</button> : (
                  <div><ul className="pm-steps">{confirmSend.lines.map((l) => <li key={l.field}><b>{l.field}:</b> {l.after}</li>)}</ul><p className="ap-fine my-1">{confirmSend.note} Type SEND to confirm.</p><input className="ap-field" value={typed} onChange={(e) => setTyped(e.target.value)} aria-label="Type SEND" /> <button type="button" className="s6-btn" disabled={typed !== "SEND"} onClick={() => void resend("do")}>Send</button></div>)}</div>}
              </section>
            </>
          )}
        </Load>
        {msg && <p className="text-sm" role="status" data-testid="pm-msg">{msg}</p>}
        {err && <p className="text-sm" role="alert" data-testid="pm-err">{err}</p>}
        <p className="ap-fine">Read only: SubSync cannot charge, retry or change a payment.</p>
      </aside>
    </>
  );
}
