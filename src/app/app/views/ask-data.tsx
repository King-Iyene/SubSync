"use client";

import { useEffect, useRef, useState } from "react";
import { usePageRange } from "../ds/page-range";
import { useApiClient, useData } from "../session";

// Ask your data: a question box (on Today, and from the Ctrl K search). The AI may only call a fixed list of read-only totals; each number in the answer has a "Rows" button that opens exactly
// the rows behind it (the count equals the rows). The date bar sets the period. Each person keeps their own history and can delete it (typed confirmation). Nothing here changes anything.

export type AidStatus = {
  jobs: Record<"ask_data" | "data_review" | "data_clean" | "dup_adjudicate" | "setup_audit", { flag: boolean; connected: boolean; on: boolean }>;
  shareNames: boolean; canReview: boolean; canClean: boolean; accountLimited: boolean; demo: boolean;
};
type Citation = { label: string; value: string; rowsHash: string; rowCount: number };
type Answer = { answer: string; citations: Citation[]; cannotAnswer: boolean };
type Turn = { id: string; at: string; question: string; answer: Answer; window: { from: string | null; to: string | null } };
type AskRes = { ok: true; turnId: string; answer: Answer; window: string; account: string | null; cached: boolean } | { ok: false; error: string; code?: string };
type RowsRes = { columns: string[]; rows: Array<Array<string | number | null>>; total: number; window: string };

const BTN = "ds-press inline-flex min-h-10 items-center justify-center rounded-lg border bg-card px-3 text-sm font-medium hover:border-primary/40 hover:bg-accent/50 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";
const PRIMARY = "ds-press inline-flex min-h-10 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";
const IDEAS = ["How many leads are waiting for a reply?", "Which client account had the slowest first replies?", "What is my show rate?", "How much money is at risk in stale deals?", "How many duplicate contacts do I have?"];

export const useAidStatus = (on = true) => useData<AidStatus>(on ? "aid?part=status" : null);

/** The exact rows behind one number. Same rows the number counted. */
export function RowsDrawer({ hash, account, label, onClose }: { hash: string; account: string | null; label: string; onClose: () => void }) {
  const api = useApiClient();
  const [res, setRes] = useState<RowsRes | null>(null), [rows, setRows] = useState<RowsRes["rows"]>([]), [err, setErr] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const load = async (offset: number) => {
    setBusy(true); setErr(null);
    try {
      const r = await api.get<RowsRes>(`aid?part=rows&hash=${encodeURIComponent(hash)}&offset=${offset}&limit=25${account ? `&account=${encodeURIComponent(account)}` : ""}`, { fresh: true });
      setRes(r); setRows((prev) => (offset === 0 ? r.rows : [...prev, ...r.rows]));
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps, react-hooks/set-state-in-effect
  useEffect(() => { void load(0); }, [hash, account]);
  return (
    <div className="fixed inset-0 z-50 print:hidden" data-testid="ask-rows">
      <div className="absolute inset-0 bg-black/45" onClick={onClose} aria-hidden />
      <div role="dialog" aria-modal="true" aria-label={`Rows behind ${label}`} className="absolute inset-x-0 bottom-0 top-[10vh] mx-auto flex w-[min(60rem,96vw)] flex-col overflow-hidden rounded-t-xl border bg-popover text-popover-foreground shadow-[var(--shadow-lift)]">
        <div className="flex items-start justify-between gap-3 border-b px-4 py-3">
          <div className="min-w-0"><p className="truncate font-medium">{label}</p><p className="text-xs text-muted-foreground" data-testid="ask-rows-count">{res ? `${res.total.toLocaleString("en-US")} ${res.total === 1 ? "row" : "rows"}, the same ones the number counted. ${res.window}` : "Loading the rows..."}</p></div>
          <button type="button" className={BTN} onClick={onClose}>Close</button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          {err && <p className="p-4 text-sm text-destructive" role="alert">{err}</p>}
          {res && res.rows.length === 0 && rows.length === 0 && <p className="p-4 text-sm text-muted-foreground">No rows.</p>}
          {res && rows.length > 0 && (
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-muted/70 text-xs text-muted-foreground"><tr>{res.columns.map((c) => <th key={c} className="px-3 py-2 font-medium">{c}</th>)}</tr></thead>
              <tbody className="divide-y">{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className="max-w-[16rem] truncate px-3 py-2">{c === null || c === "" ? <span className="text-muted-foreground">-</span> : String(c)}</td>)}</tr>)}</tbody>
            </table>
          )}
        </div>
        {res && rows.length < Math.min(res.total, 2000) && <div className="border-t px-4 py-2"><button type="button" className={BTN} disabled={busy} onClick={() => void load(rows.length)}>{busy ? "Loading..." : "Show more"}</button></div>}
      </div>
    </div>
  );
}

function AnswerView({ a, account, window: w }: { a: Answer; account: string | null; window?: string }) {
  const [open, setOpen] = useState<Citation | null>(null);
  return (
    <div className="space-y-2" data-testid="ask-answer">
      <p className="text-base">{a.answer}</p>
      {a.citations.length > 0 && (
        <ul className="divide-y rounded-lg border bg-card" aria-label="The numbers used">
          {a.citations.map((c) => (
            <li key={c.rowsHash} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <span className="min-w-0 truncate">{c.label}: <b className="tabular-nums">{c.value}</b></span>
              <button type="button" className={BTN} onClick={() => setOpen(c)} data-testid="ask-rows-btn" title="Open exactly the rows behind this number">Rows ({c.rowCount.toLocaleString("en-US")})</button>
            </li>
          ))}
        </ul>
      )}
      {w && <p className="text-xs text-muted-foreground">{w}. The date bar at the top sets the period. These figures are from your own data, worked out by SubSync; the AI only wrote the words.</p>}
      {open && <RowsDrawer hash={open.rowsHash} account={account} label={open.label} onClose={() => setOpen(null)} />}
    </div>
  );
}

/** The question box and the person's own history. Used on Today and inside the Ctrl K dialog. */
export function AskBox({ account = null, initial = "", autoRun = false, compact = false }: { account?: string | null; initial?: string; autoRun?: boolean; compact?: boolean }) {
  const api = useApiClient(), range = usePageRange();
  const st = useAidStatus();
  const hist = useData<{ turns: Turn[] }>(st.data?.jobs.ask_data.flag ? "aid?part=history" : null);
  const [q, setQ] = useState(initial), [busy, setBusy] = useState(false), [res, setRes] = useState<AskRes | null>(null), [asked, setAsked] = useState("");
  const [del, setDel] = useState<{ id: string | "all"; typed: string } | null>(null), [msg, setMsg] = useState<string | null>(null), [showHist, setShowHist] = useState(false);
  const job = st.data?.jobs.ask_data;
  const autoDone = useRef(false);
  const run = async (text = q) => {
    if (busy || text.trim().length < 3) return;
    setBusy(true); setRes(null); setAsked(text.trim());
    try { setRes(await api.post<AskRes>("aid/act/ask", { question: text, account, ...(range.ready ? { from: range.from, to: range.to } : {}) })); void hist.reload?.(); }
    catch (e) { setRes({ ok: false, error: (e as Error).message }); } finally { setBusy(false); }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (!autoDone.current && autoRun && initial && job?.flag && job.connected && job.on && range.ready) { autoDone.current = true; void run(initial); } }, [autoRun, job?.flag, job?.connected, job?.on, range.ready]);
  if (!job?.flag) return null;
  const remove = async () => {
    if (!del) return;
    try { await api.post("aid/act/history-delete", del.id === "all" ? { all: true, confirm: del.typed } : { id: del.id, confirm: del.typed }); setDel(null); setMsg("Deleted."); await hist.reload?.(); }
    catch (e) { setMsg((e as Error).message); }
  };
  const turns = hist.data?.turns ?? [];
  return (
    <section className={compact ? "space-y-3" : "space-y-3 rounded-xl border bg-card p-4"} aria-label="Ask your data" data-testid="ask-data">
      {!compact && <div><h2 className="text-base font-semibold">Ask your data</h2><p className="text-sm text-muted-foreground">Ask about your leads, replies, appointments, deals or data quality. Answers come only from your own numbers, and every number opens its rows.</p></div>}
      {!job.connected || !job.on ? (
        <p className="rounded-lg border border-dashed px-3 py-2 text-sm text-muted-foreground" role="status" data-testid="ask-off">
          {!job.connected ? "Connect your own AI account first (Settings, Integrations, AI). SubSync never pays for AI." : "Ask your data is off for this account. Switch it on in Settings, Integrations, AI."}
        </p>
      ) : (
        <>
          <form onSubmit={(e) => { e.preventDefault(); void run(); }} className="flex flex-wrap gap-2">
            <input value={q} onChange={(e) => setQ(e.target.value)} maxLength={300} placeholder="For example: which client had the slowest replies?" aria-label="Your question" data-testid="ask-input" className="min-h-10 min-w-0 flex-1 basis-64 rounded-lg border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary" />
            <button type="submit" className={PRIMARY} disabled={busy || q.trim().length < 3} data-testid="ask-go">{busy ? "Working it out..." : "Ask"}</button>
          </form>
          {!res && !busy && <p className="flex flex-wrap gap-2">{IDEAS.slice(0, compact ? 3 : 5).map((i) => <button key={i} type="button" className="rounded-full border px-2.5 py-1 text-xs text-muted-foreground hover:bg-accent/50" onClick={() => { setQ(i); void run(i); }}>{i}</button>)}</p>}
          <p className="text-xs text-muted-foreground">Period: {range.label || "the date bar"}.{st.data?.shareNames ? " Your account allows names to be sent to your AI." : " Names are not sent to your AI; it sees labels like Account 4821 and we put the real names back."}</p>
          {res && (res.ok ? <div><p className="mb-1 text-xs text-muted-foreground">You asked: {asked}</p><AnswerView a={res.answer} account={res.account} window={res.window} /></div> : <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900" role="alert" data-testid="ask-error">{res.error}</p>)}
        </>
      )}
      {turns.length > 0 && (
        <div>
          <button type="button" className="text-sm text-muted-foreground underline" onClick={() => setShowHist((s) => !s)} aria-expanded={showHist}>{showHist ? "Hide" : "Show"} my earlier questions ({turns.length})</button>
          {showHist && (
            <div className="mt-2 space-y-2" data-testid="ask-history">
              <p className="text-xs text-muted-foreground">Only you can see these. Delete any time.</p>
              {msg && <p className="text-xs" role="status">{msg}</p>}
              <ul className="divide-y rounded-lg border">
                {turns.map((t) => (
                  <li key={t.id} className="space-y-1 px-3 py-2">
                    <div className="flex items-start justify-between gap-2"><p className="text-sm font-medium">{t.question}</p><button type="button" className="shrink-0 text-xs text-destructive underline" onClick={() => setDel({ id: t.id, typed: "" })}>Delete</button></div>
                    <AnswerView a={t.answer} account={account} window={t.window.from ? `${t.window.from} to ${t.window.to}` : undefined} />
                    {del?.id === t.id && <DeleteBox word="delete" del={del} setDel={setDel} onConfirm={() => void remove()} />}
                  </li>
                ))}
              </ul>
              <button type="button" className="text-xs text-destructive underline" onClick={() => setDel({ id: "all", typed: "" })}>Delete all my questions</button>
              {del?.id === "all" && <DeleteBox word="delete all" del={del} setDel={setDel} onConfirm={() => void remove()} />}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function DeleteBox({ word, del, setDel, onConfirm }: { word: string; del: { id: string; typed: string }; setDel: (d: { id: string; typed: string } | null) => void; onConfirm: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-2" data-testid="ask-delete-box">
      <label className="text-xs" htmlFor={`del-${del.id}`}>Type <b>{word}</b> to remove it for good:</label>
      <input id={`del-${del.id}`} value={del.typed} onChange={(e) => setDel({ ...del, typed: e.target.value })} className="min-h-9 w-36 rounded-md border bg-background px-2 text-sm" />
      <button type="button" className={BTN} disabled={del.typed.trim().toLowerCase() !== word} onClick={onConfirm}>Delete</button>
      <button type="button" className={BTN} onClick={() => setDel(null)}>Cancel</button>
    </div>
  );
}

/** The card on Today. Draws nothing unless the account has the job switched on. */
export function AskDataCard({ account = null }: { account?: string | null }) {
  const st = useAidStatus();
  if (!st.data?.jobs.ask_data.flag) return null;
  return <div className="mb-4"><AskBox account={account} compact={false} /></div>;
}

/** The Ctrl K entry: a dialog that asks the question typed in the search box straight away. */
export function AskDialog({ question, onClose }: { question: string; onClose: () => void }) {
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; document.addEventListener("keydown", k); return () => document.removeEventListener("keydown", k); }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 print:hidden" data-testid="ask-dialog">
      <div className="absolute inset-0 bg-black/45" onClick={onClose} aria-hidden />
      <div role="dialog" aria-modal="true" aria-label="Ask your data" className="absolute left-1/2 top-[10vh] max-h-[80vh] w-[min(44rem,94vw)] -translate-x-1/2 overflow-y-auto rounded-xl border bg-popover p-4 text-popover-foreground shadow-[var(--shadow-lift)]">
        <div className="mb-2 flex items-center justify-between"><h2 className="text-base font-semibold">Ask your data</h2><button type="button" className={BTN} onClick={onClose}>Close</button></div>
        <AskBox initial={question} autoRun compact />
      </div>
    </div>
  );
}
