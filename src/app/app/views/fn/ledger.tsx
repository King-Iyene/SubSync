"use client";

import { useEffect, useState } from "react";
import { money } from "@/lib/analytics/finance-core";
import { EmptyState } from "../../ds";
import { useApiClient } from "../../session";
import { fnfxOn, msg, useKeyset } from "./data";
import { Money, Picker, SampleNote, Typed, num, useAct } from "./shared";
import type { FnLedger } from "./types";

// Finance, Billing notes: a simple SubSync-only ledger of what the agency bills each client (amount, due date, paid or not) with reminders on its own list. These are SubSync NOTES: they are not synced to
// the platform, not invoices, and SubSync never sends them to anyone. Deleting a note needs its name typed. Every count opens exactly its rows.
type Row = FnLedger["rows"][number];
const BUCKETS = [["all", "All"], ["overdue", "Overdue"], ["due_soon", "Due this week"], ["upcoming", "Later"], ["paid", "Paid"]] as const;
const BUCKET_TONE: Record<string, string | undefined> = { overdue: "amber", due_soon: "cyan", upcoming: undefined, paid: "green" };

export function LedgerTab() {
  const api = useApiClient();
  const [bucket, setBucket] = useState<string>("all"), [q, setQ] = useState(""), [dq, setDq] = useState(""), [acct, setAcct] = useState<{ id: string; name: string } | null>(null), [adding, setAdding] = useState(false), [rev, setRev] = useState(0), [edit, setEdit] = useState<Row | null>(null), [rm, setRm] = useState<Row | null>(null), [file, setFile] = useState<string | null>(null);
  useEffect(() => { const t = setTimeout(() => setDq(q), 300); return () => clearTimeout(t); }, [q]);
  const k = useKeyset<Row, FnLedger>("ledger", { bucket, q: dq, location: acct?.id, v: rev }, { size: 20 });
  const { busy, note, run } = useAct(() => setRev((n) => n + 1));
  const d = k.first;
  if (k.error && /not switched on/i.test(String((k.error as Error).message))) return <EmptyState title="Not switched on yet" body="This part of Finance is not switched on for your account yet." />;
  const exportCsv = async () => { if (fnfxOn()) return setFile("Sample data: nothing is saved."); try { await api.download("finance?part=export&what=ledger", "billing-notes.csv"); } catch (e) { setFile(msg(e)); } };
  return (
    <div className="fn-stack" data-testid="fn-ledger">
      {fnfxOn() && <SampleNote />}
      <section className="fn-card" aria-label="Billing notes">
        <h2 className="fn-h">What you bill your clients</h2>
        <p className="fn-sentence" data-testid="fn-ledger-sentence">{d ? (d.counts.overdue > 0 ? <>{num(d.counts.overdue)} overdue, <Money items={d.overdue} /> in total.</> : d.owed.length ? <>Nothing is overdue. <Money items={d.owed} /> is still to come in.</> : "No unpaid notes.") : "Loading..."}</p>
        <p className="ap-fine">These are SubSync notes for your own use. They are not synced to the platform, they are not invoices, and SubSync never sends them to anyone.</p>
        {d && d.reminders > 0 && <p className="fn-notice" role="status" data-testid="fn-reminders">{num(d.reminders)} {d.reminders === 1 ? "note needs" : "notes need"} a reminder: overdue, due this week, or past the reminder day you set.</p>}
      </section>
      <div role="group" aria-label="Which notes" className="cl3-chips">
        {BUCKETS.map(([v, l]) => <button key={v} type="button" className="cl-reason" aria-pressed={bucket === v} data-on={bucket === v ? "1" : undefined} onClick={() => setBucket(v)} data-testid={`fn-ledger-chip-${v}`}>{l}{d && v !== "all" ? ` (${num(d.counts[v])})` : ""}</button>)}
      </div>
      <div className="ap-head print:hidden" role="search">
        <label className="ap-search"><span className="sr-only">Search notes</span><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search notes or accounts" data-testid="fn-ledger-search" /></label>
        <div style={{ minWidth: 220 }}><Picker what="account" label="Client account" value={acct} clearable onPick={setAcct} placeholder="Every client account" /></div>
        <button type="button" className="s6-btn" data-kind="primary" onClick={() => { setAdding(!adding); setEdit(null); }} aria-expanded={adding} data-testid="fn-ledger-add">{adding ? "Close" : "Add a note"}</button>
        <button type="button" className="s6-btn" onClick={() => void exportCsv()}>Export CSV</button>
      </div>
      {(adding || edit) && <NoteForm row={edit} onDone={() => { setAdding(false); setEdit(null); setRev((n) => n + 1); }} />}
      {(note || file) && <p className="ap-fine" role="status" data-testid="fn-ledger-note">{note ?? file}</p>}
      {k.loading && !d ? <p className="ap-fine">Loading...</p> : k.error ? <EmptyState title="Could not load" body={msg(k.error)} /> : k.rows.length === 0 ? (
        <EmptyState title="No notes here" body={bucket === "all" ? "Add a note for each thing you bill a client, like a monthly retainer. SubSync keeps the due dates and lists what is overdue." : "Nothing in this group."} />
      ) : (
        <>
          <p className="ap-fine" data-testid="fn-ledger-count">{num(k.total)} {k.total === 1 ? "note" : "notes"}.</p>
          <ul className="fn-list" data-testid="fn-ledger-list">
            {k.rows.map((r) => (
              <li key={r.id} className="fn-row" data-pri={r.bucket === "overdue" ? "high" : undefined} data-testid="fn-ledger-row" style={{ gridTemplateColumns: "minmax(0,1.4fr) minmax(0,1fr) minmax(0,1.2fr) auto" }}>
                <div><span className="fn-who">{r.account}</span><div className="fn-sub">{r.label}</div></div>
                <div><span className="fn-amt">{money(r.amount, r.currency)}</span><div className="fn-sub">Due {r.dueOn}{r.paidOn ? ` · paid ${r.paidOn}` : ""}</div></div>
                <div><span className="ap-chip" data-tone={BUCKET_TONE[r.bucket]} data-alert={r.bucket === "overdue" ? "overdue" : undefined}>{r.bucket === "overdue" ? "Overdue" : r.bucket === "due_soon" ? "Due this week" : r.bucket === "paid" ? "Paid" : "Not due yet"}</span>{r.remindOn && r.status === "unpaid" && <div className="fn-sub">Remind {r.remindOn}</div>}{r.note && <div className="fn-sub">{r.note}</div>}</div>
                <div className="fn-end print:hidden">
                  <button type="button" className="s6-btn" disabled={busy} onClick={() => void run(() => api.post("finance/ledger/mark", { id: r.id, paid: r.status !== "paid" }))} data-testid="fn-ledger-mark">{r.status === "paid" ? "Mark unpaid" : "Mark paid"}</button>
                  <button type="button" className="ap-link" onClick={() => { setEdit(r); setAdding(false); }}>Edit</button>
                  <button type="button" className="ap-link" onClick={() => setRm(r)} data-testid="fn-ledger-remove">Remove</button>
                </div>
              </li>
            ))}
          </ul>
          {rm && <Typed name={rm.label} verb="remove this note" busy={busy} onCancel={() => setRm(null)} onConfirm={(t) => void run(() => api.post("finance/ledger/remove", { id: rm.id, confirm: t }), "Note removed.").then(() => setRm(null))} />}
          {k.next && <div className="fn-more"><span className="ap-fine">Showing {num(k.rows.length)} of {num(k.total)}</span><button type="button" className="s6-btn" onClick={k.showMore} disabled={k.more}>{k.more ? "Loading..." : "Show more"}</button></div>}
        </>
      )}
    </div>
  );
}

function NoteForm({ row, onDone }: { row: Row | null; onDone: () => void }) {
  const api = useApiClient(), { busy, note, run } = useAct();
  const [acct, setAcct] = useState<{ id: string; name: string } | null>(row ? { id: row.locationId, name: row.account } : null);
  const [label, setLabel] = useState(row?.label ?? ""), [amount, setAmount] = useState(row ? String(row.amount) : ""), [currency, setCurrency] = useState(row?.currency ?? "USD"), [due, setDue] = useState(row?.dueOn ?? ""), [remind, setRemind] = useState(row?.remindOn ?? ""), [text, setText] = useState(row?.note ?? "");
  const body = { label, amount: amount === "" ? undefined : Number(amount), currency, dueOn: due, remindOn: remind || null, note: text || null };
  const save = () => run(async () => { if (row) await api.put("finance/ledger", { id: row.id, ...body }); else { if (!acct) throw new Error("Choose the client account"); await api.post("finance/ledger/add", { locationId: acct.id, ...body }); } onDone(); });
  return (
    <section className="fn-card" aria-label={row ? "Edit the note" : "Add a note"} data-testid="fn-ledger-form">
      <div className="fn-form">
        {!row && <Picker what="account" label="Client account" value={acct} onPick={setAcct} testId="fn-ledger-account" />}
        <label>What it is for<input className="ap-field" value={label} maxLength={120} onChange={(e) => setLabel(e.target.value)} placeholder="March retainer" data-testid="fn-ledger-label" /></label>
        <label>Amount<input className="ap-field" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} data-testid="fn-ledger-amount" /></label>
        <label>Currency<input className="ap-field" value={currency} maxLength={3} onChange={(e) => setCurrency(e.target.value.toUpperCase())} /></label>
        <label>Due date<input className="ap-field" type="date" value={due} onChange={(e) => setDue(e.target.value)} data-testid="fn-ledger-due" /></label>
        <label>Remind me on (optional)<input className="ap-field" type="date" value={remind} onChange={(e) => setRemind(e.target.value)} /></label>
        <label>Note (optional)<input className="ap-field" value={text} maxLength={1000} onChange={(e) => setText(e.target.value)} /></label>
        <button type="button" className="s6-btn" data-kind="primary" disabled={busy} onClick={() => void save()} data-testid="fn-ledger-save">{row ? "Save changes" : "Add the note"}</button>
      </div>
      {note && <p className="ap-fine" role="status">{note}</p>}
    </section>
  );
}
